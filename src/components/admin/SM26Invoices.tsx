import { useState, useEffect, useRef } from 'react';
import { Receipt, Loader2, Upload, ExternalLink, Trash2, FileText } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { useFileDrop } from '@/hooks/useFileDrop';

// Admin invoice documents for one SM26 registration. Uploading an invoice:
//  1. stores the file in event-media under invoices/<registration_id>/,
//  2. records an sm_invoice row (participants read it in their event hub),
//  3. moves the payment status unpaid → invoiced (never downgrades paid/waived),
//  4. optionally emails the participant that the invoice is on their account.

interface InvoiceRow {
  id: string; file_path: string; label: string | null;
  amount_cents: number | null; currency: string | null; created_at: string;
}

const fileName = (path: string) => {
  const base = path.split('/').pop() || path;
  // strip the timestamp prefix we add on upload (e.g. "1783671178-invoice.pdf")
  return base.replace(/^\d{10,}-/, '');
};

// Strict euro parsing: "1500", "1500.50", "1500,50". Anything else (thousand
// separators, negatives, trailing text) is rejected rather than mis-stored.
const parseAmountCents = (raw: string): number | null | 'invalid' => {
  const s = raw.replace(/\s/g, '');
  if (!s) return null;
  if (!/^\d+([.,]\d{1,2})?$/.test(s)) return 'invalid';
  return Math.round(parseFloat(s.replace(',', '.')) * 100);
};

export function SM26Invoices({ registrationId, eventId, onChange }: {
  registrationId: string; eventId: string; onChange?: () => void;
}) {
  const [rows, setRows] = useState<InvoiceRow[]>([]);
  const [billTo, setBillTo] = useState<{ company: string | null; address: string | null; vat: string | null; attendees: number | null; attendeesConfirmedAt: string | null }>({ company: null, address: null, vat: null, attendees: null, attendeesConfirmedAt: null });
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [notify, setNotify] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { isDragging, dropHandlers } = useFileDrop(files => { const f = files[0]; if (f) void upload(f); }, uploading);

  const load = async () => {
    const [{ data }, { data: reg }] = await Promise.all([
      supabase.from('sm_invoice')
        .select('id,file_path,label,amount_cents,currency,created_at')
        .eq('registration_id', registrationId)
        .order('created_at', { ascending: false }),
      supabase.from('sm_registration').select('company_name,billing_address,vat_number,num_attendees,attendees_confirmed_at').eq('id', registrationId).maybeSingle(),
    ]);
    setRows((data || []) as InvoiceRow[]);
    const r = reg as { company_name?: string | null; billing_address?: string | null; vat_number?: string | null; num_attendees?: number | null; attendees_confirmed_at?: string | null } | null;
    setBillTo({ company: r?.company_name || null, address: r?.billing_address || null, vat: r?.vat_number || null, attendees: r?.num_attendees ?? null, attendeesConfirmedAt: r?.attendees_confirmed_at || null });
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [registrationId]);

  // Move unpaid → invoiced when an invoice document is attached; never touch an
  // already invoiced/paid/waived row (the payment panel stays authoritative).
  // Carries the typed amount onto sm_payment when it has none, so the
  // notification email (which reads sm_payment) shows the same figure.
  const ensureInvoiced = async (cents: number | null): Promise<'moved' | 'unchanged' | 'failed'> => {
    const { data: pay } = await supabase.from('sm_payment').select('id,status,amount_cents').eq('registration_id', registrationId).maybeSingle();
    const now = new Date().toISOString();
    const cur = pay as { id: string; status?: string; amount_cents?: number | null } | null;
    if (!cur) {
      const { error } = await supabase.from('sm_payment').upsert(
        { registration_id: registrationId, event_id: eventId, status: 'invoiced', amount_cents: cents, currency: 'EUR', invoiced_at: now, updated_at: now },
        { onConflict: 'registration_id' },
      );
      return error ? 'failed' : 'moved';
    }
    if (cur.status === 'unpaid') {
      const { error } = await supabase.from('sm_payment')
        .update({ status: 'invoiced', invoiced_at: now, updated_at: now, ...(cur.amount_cents == null && cents != null ? { amount_cents: cents } : {}) })
        .eq('id', cur.id);
      return error ? 'failed' : 'moved';
    }
    return 'unchanged';
  };

  const upload = async (file: File) => {
    const cents = parseAmountCents(amount);
    if (cents === 'invalid') {
      toast({ title: 'Check the amount', description: 'Use a plain figure like 1500 or 1500.50 (no thousand separators).', variant: 'destructive' });
      if (fileRef.current) fileRef.current.value = '';
      return;
    }
    setUploading(true);
    try {
      const safe = file.name.replace(/[^\w.\-]+/g, '_').slice(-80);
      const path = `invoices/${registrationId}/${Date.now()}-${safe}`;
      const { error: upErr } = await supabase.storage.from('event-media').upload(path, file, { upsert: false });
      if (upErr) { toast({ title: 'Upload failed', description: upErr.message, variant: 'destructive' }); return; }
      const { data: u } = await supabase.auth.getUser();
      const { error: insErr } = await supabase.from('sm_invoice').insert({
        event_id: eventId, registration_id: registrationId, file_path: path,
        label: label.trim() || null, amount_cents: cents, currency: 'EUR',
        created_by: u?.user?.id || null,
      });
      if (insErr) {
        const { error: rmErr } = await supabase.storage.from('event-media').remove([path]);
        if (rmErr) console.error('invoice rollback: could not remove uploaded file', path, rmErr);
        toast({ title: 'Could not save invoice', description: insErr.message, variant: 'destructive' });
        return;
      }
      const payMove = await ensureInvoiced(cents);
      // Email the participant — awaited so the toast tells the truth.
      let emailNote = 'No email sent.';
      if (notify) {
        const { data: mail, error: mailErr } = await supabase.functions.invoke('sm26-email', {
          body: { registration_id: registrationId, kind: 'invoice_available' },
        });
        const skipped = (mail as { skipped?: string } | null)?.skipped;
        emailNote = mailErr ? '⚠ The notification email could not be sent — please follow up manually.'
          : skipped ? '⚠ No email address on this registration — the participant was NOT notified.'
          : 'The participant was notified by email.';
      }
      const statusNote = payMove === 'moved' ? ' Payment marked as Invoiced.'
        : payMove === 'failed' ? ' ⚠ Payment status could not be updated — set it in the payment panel.' : '';
      toast({ title: 'Invoice uploaded', description: `${emailNote}${statusNote}` });
      setLabel(''); setAmount('');
      await load();
      onChange?.();
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const view = async (path: string) => {
    const { data, error } = await supabase.storage.from('event-media').createSignedUrl(path, 300);
    if (error || !data) { toast({ title: 'Could not open file', variant: 'destructive' }); return; }
    window.open(data.signedUrl, '_blank');
  };

  // DB row first, storage second: a leftover file with no sm_invoice row is
  // invisible to participants (the storage policy matches rows), whereas the
  // reverse order could leave a visible entry pointing at a deleted file.
  const remove = async (row: InvoiceRow) => {
    if (!window.confirm('Delete this invoice? The participant will no longer see it in their event hub.')) return;
    setBusy(row.id);
    const { error } = await supabase.from('sm_invoice').delete().eq('id', row.id);
    if (error) { setBusy(null); toast({ title: 'Could not delete', description: error.message, variant: 'destructive' }); return; }
    const { error: rmErr } = await supabase.storage.from('event-media').remove([row.file_path]);
    setBusy(null);
    if (rmErr) console.error('invoice delete: file could not be removed from storage', row.file_path, rmErr);
    setRows(prev => prev.filter(r => r.id !== row.id));
    onChange?.();
  };

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2"><Receipt className="h-4 w-4 text-primary" /> Invoices</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {(billTo.address || billTo.vat) ? (
          <div className="rounded-lg border border-gray-100 bg-gray-50/60 p-3 text-sm">
            <div className="text-[11px] uppercase tracking-wide text-gray-400 mb-1">Bill to</div>
            {billTo.company && <div className="font-medium text-gray-900">{billTo.company}</div>}
            {billTo.address && <div className="text-gray-600 whitespace-pre-wrap">{billTo.address}</div>}
            {billTo.vat && <div className="text-gray-500 mt-0.5">VAT: {billTo.vat}</div>}
          </div>
        ) : (
          <p className="text-[11px] text-amber-600">No billing address / VAT captured yet — the participant can add it under “My details” in their event hub, or you can request it.</p>
        )}
        {(billTo.attendees || 0) > 1 && (
          billTo.attendeesConfirmedAt ? (
            <p className="text-[11px] text-emerald-600">
              ✓ Attendee list confirmed ({billTo.attendees} attendees) on {new Date(billTo.attendeesConfirmedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })} — headcount is locked, ready to invoice.
            </p>
          ) : (
            <p className="text-[11px] text-amber-600">
              Attendee list not confirmed yet ({billTo.attendees} on the roster) — the headcount may still change before you invoice.
            </p>
          )
        )}
        {rows.length === 0 && <p className="text-sm text-gray-400">No invoice uploaded yet.</p>}
        {rows.map(r => (
          <div key={r.id} className="flex items-center justify-between gap-3 rounded-lg border border-gray-100 p-3">
            <div className="min-w-0 flex items-center gap-2.5">
              <FileText className="h-4 w-4 text-gray-400 shrink-0" />
              <div className="min-w-0">
                <div className="text-sm font-medium text-gray-900 truncate">{r.label || fileName(r.file_path)}</div>
                <div className="text-xs text-gray-500">
                  {r.amount_cents != null && <>{(r.amount_cents / 100).toFixed(2)} {r.currency || 'EUR'} · </>}
                  {new Date(r.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <Button size="sm" variant="ghost" className="h-8 gap-1.5 text-gray-600" onClick={() => view(r.file_path)}>
                <ExternalLink className="h-3.5 w-3.5" /> View
              </Button>
              <Button size="sm" variant="ghost" className="h-8 text-gray-400 hover:text-red-600" disabled={busy === r.id} onClick={() => remove(r)}>
                {busy === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              </Button>
            </div>
          </div>
        ))}

        <div {...dropHandlers} className={`rounded-lg border border-dashed p-3 space-y-2 transition-colors ${isDragging ? 'border-primary bg-primary/5' : 'border-gray-200'}`}>
          <div className="grid sm:grid-cols-2 gap-2">
            <Input placeholder="Label (optional, e.g. Participation fee)" value={label} onChange={e => setLabel(e.target.value)} className="h-9" />
            <Input placeholder="Amount € (optional, e.g. 1500.00)" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} className="h-9" />
          </div>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
              <Checkbox checked={notify} onCheckedChange={v => setNotify(v === true)} />
              Email the participant that their invoice is available
            </label>
            <Button size="sm" className="gap-1.5" disabled={uploading} onClick={() => fileRef.current?.click()}>
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Upload invoice
            </Button>
          </div>
          <p className="text-[11px] text-gray-400">
            Drag a file here, or click <strong>Upload invoice</strong>. It appears in the participant's event hub and moves payment to <strong>Invoiced</strong> (never downgrades Paid). Uncheck the email box for corrected re-uploads.
          </p>
          <input ref={fileRef} type="file" accept="application/pdf,image/*" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) void upload(f); }} />
        </div>
      </CardContent>
    </Card>
  );
}
