import { useState, useEffect } from 'react';
import { Loader2, CreditCard, Save } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';

// Per-registration payment tracking. Invoicing is manual (no card processing),
// so this records the invoice ref, amount and where it stands. One sm_payment
// row per registration (unique). Read by the participant on /sm26/me.

const STATUSES = ['unpaid', 'invoiced', 'paid', 'waived'] as const;
const pretty = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const statusClass = (s: string) =>
  s === 'paid' || s === 'waived' ? 'bg-green-50 text-green-700 border-green-200'
  : s === 'invoiced' ? 'bg-amber-50 text-amber-700 border-amber-200'
  : 'bg-gray-50 text-gray-600 border-gray-200';

export function SM26PaymentPanel({ registrationId, eventId }: { registrationId: string; eventId: string }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('unpaid');
  const [amount, setAmount] = useState(''); // euros
  const [invoiceRef, setInvoiceRef] = useState('');
  const [note, setNote] = useState('');
  const [invoicedAt, setInvoicedAt] = useState<string | null>(null);
  const [paidAt, setPaidAt] = useState<string | null>(null);

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [registrationId]);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('sm_payment')
      .select('status,amount_cents,invoice_ref,note,invoiced_at,paid_at')
      .eq('registration_id', registrationId)
      .maybeSingle();
    if (data) {
      const p = data as { status: string; amount_cents: number | null; invoice_ref: string | null; note: string | null; invoiced_at: string | null; paid_at: string | null };
      setStatus(p.status || 'unpaid');
      setAmount(p.amount_cents != null ? String(p.amount_cents / 100) : '');
      setInvoiceRef(p.invoice_ref || '');
      setNote(p.note || '');
      setInvoicedAt(p.invoiced_at);
      setPaidAt(p.paid_at);
    }
    setLoading(false);
  };

  const save = async () => {
    setSaving(true);
    const now = new Date().toISOString();
    const nextInvoicedAt = (status === 'invoiced' || status === 'paid') ? (invoicedAt || now) : invoicedAt;
    const nextPaidAt = status === 'paid' ? (paidAt || now) : null;
    const cents = amount.trim() ? Math.round(parseFloat(amount) * 100) : null;
    const { error } = await supabase.from('sm_payment').upsert({
      registration_id: registrationId,
      event_id: eventId,
      status,
      amount_cents: Number.isFinite(cents as number) ? cents : null,
      currency: 'EUR',
      invoice_ref: invoiceRef.trim() || null,
      note: note.trim() || null,
      invoiced_at: nextInvoicedAt,
      paid_at: nextPaidAt,
      updated_at: now,
    }, { onConflict: 'registration_id' });
    setSaving(false);
    if (error) { toast({ title: 'Could not save payment', description: error.message, variant: 'destructive' }); return; }
    setInvoicedAt(nextInvoicedAt);
    setPaidAt(nextPaidAt);
    toast({ title: 'Payment saved' });
  };

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2"><CreditCard className="h-4 w-4 text-gray-400" /> Payment</CardTitle>
          {!loading && <Badge className={`text-[10px] ${statusClass(status)}`}>{pretty(status)}</Badge>}
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="py-2 text-xs text-gray-400 flex items-center gap-2"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…</div>
        ) : (
          <div className="space-y-3">
            <div className="grid sm:grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Status</Label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>{STATUSES.map(s => <SelectItem key={s} value={s}>{pretty(s)}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Amount (€, VAT excl.)</Label>
                <Input type="number" min={0} step="1" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0" className="h-9" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Invoice ref</Label>
                <Input value={invoiceRef} onChange={e => setInvoiceRef(e.target.value)} placeholder="e.g. SM26-0042" className="h-9" />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Note</Label>
              <Input value={note} onChange={e => setNote(e.target.value)} placeholder="Optional — payment terms, partial payment, etc." className="h-9" />
            </div>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="text-xs text-gray-400 space-x-3">
                {invoicedAt && <span>Invoiced {new Date(invoicedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</span>}
                {paidAt && <span className="text-green-600">Paid {new Date(paidAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</span>}
              </div>
              <Button size="sm" className="gap-1.5" onClick={save} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save payment
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
