import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, FileText, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { BTN_OUTLINE, FOCUS, MemberPanel, StatusPill, type PillTone } from '@/components/member/MemberUI';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

/**
 * "Your invoices" on the member dashboard: every invoice M3 uploaded for an event
 * registration (sm_invoice, PDFs in the event-media bucket under invoices/), grouped by
 * event. An invoice belongs to the person who registered and, when the company
 * registered, to every member of that company — the same rule as the RLS
 * (sm_can_access_registration). Staff can read every invoice through RLS, so the list
 * is filtered here to the viewer's own registrations and companies.
 * Renders nothing when the viewer has no invoice.
 */

interface InvoiceRow {
  id: string;
  file_path: string;
  label: string | null;
  amount_cents: number | null;
  currency: string | null;
  created_at: string;
  registration: { id: string; user_id: string | null; organization_id: string | null; company_name: string | null } | null;
  event: { id: string; name: string; start_date: string | null } | null;
}

interface EventGroup {
  id: string;
  name: string;
  startDate: string | null;
  invoices: InvoiceRow[];
}

type PayStatus = 'paid' | 'waived' | 'invoiced' | 'unpaid';


/** The label, else the file name as uploaded without the upload timestamp, underscores or extension. */
function invoiceName(inv: InvoiceRow): string {
  if (inv.label) return inv.label;
  const file = (inv.file_path.split('/').pop() || '').replace(/^\d{10,}-/, '').replace(/\.pdf$/i, '');
  return file.replace(/_/g, ' ').replace(/\s+/g, ' ').trim() || 'Invoice';
}

function downloadName(inv: InvoiceRow): string {
  const base = (inv.file_path.split('/').pop() || 'invoice.pdf').replace(/^\d{10,}-/, '');
  return base.toLowerCase().endsWith('.pdf') ? base : `${base}.pdf`;
}

export function MyInvoices() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const [groups, setGroups] = useState<EventGroup[]>([]);
  const [payStatus, setPayStatus] = useState<Record<string, PayStatus>>({});
  const [downloading, setDownloading] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const [{ data: memberships }, { data: rows, error }] = await Promise.all([
        supabase.from('organization_members').select('organization_id').eq('user_id', user.id),
        supabase
          .from('sm_invoice')
          .select('id,file_path,label,amount_cents,currency,created_at,registration:sm_registration(id,user_id,organization_id,company_name),event:sm_event(id,name,start_date)')
          .order('created_at', { ascending: false }),
      ]);
      if (cancelled || error || !rows) return;
      const myOrgs = new Set((memberships || []).map((m: { organization_id: string }) => m.organization_id));
      const mine = (rows as unknown as InvoiceRow[]).filter((inv) => {
        const r = inv.registration;
        return !!r && (r.user_id === user.id || (!!r.organization_id && myOrgs.has(r.organization_id)));
      });

      const byEvent = new Map<string, EventGroup>();
      for (const inv of mine) {
        const key = inv.event?.id || 'other';
        if (!byEvent.has(key)) {
          byEvent.set(key, { id: key, name: inv.event?.name || 'Event', startDate: inv.event?.start_date || null, invoices: [] });
        }
        byEvent.get(key)!.invoices.push(inv);
      }
      // Most recent event first.
      const sorted = [...byEvent.values()].sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''));
      setGroups(sorted);

      const regIds = [...new Set(mine.map((inv) => inv.registration!.id))];
      if (regIds.length > 0) {
        const { data: pays } = await supabase.from('sm_payment').select('registration_id,status').in('registration_id', regIds);
        if (cancelled) return;
        const map: Record<string, PayStatus> = {};
        for (const p of (pays || []) as { registration_id: string; status: PayStatus }[]) map[p.registration_id] = p.status;
        setPayStatus(map);
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

  if (groups.length === 0) return null;

  const download = async (inv: InvoiceRow) => {
    setDownloading(inv.id);
    // A short-lived signed link served as an attachment: the PDF downloads and the dashboard stays open.
    const { data, error } = await supabase.storage
      .from('event-media')
      .createSignedUrl(inv.file_path, 300, { download: downloadName(inv) });
    setDownloading(null);
    if (error || !data) {
      toast({ title: t('dashboard.invoices.error', 'Could not download this invoice. Please try again.'), variant: 'destructive' });
      return;
    }
    window.location.assign(data.signedUrl);
  };

  const statusPill = (inv: InvoiceRow): { label: string; tone: PillTone } | null => {
    const s = payStatus[inv.registration!.id];
    if (s === 'paid') return { label: t('dashboard.invoices.paid', 'Paid'), tone: 'success' };
    if (s === 'waived') return { label: t('dashboard.invoices.waived', 'No payment due'), tone: 'neutral' };
    if (s === 'invoiced' || s === 'unpaid') return { label: t('dashboard.invoices.due', 'Payment due'), tone: 'warning' };
    return null;
  };

  return (
    <MemberPanel title={t('dashboard.invoices.title', 'Your invoices')} count={groups.reduce((n, g) => n + g.invoices.length, 0)}>
      <p className="border-b border-rule px-5 py-3 text-sm text-meta">
        {t('dashboard.invoices.intro', 'Invoices from M3 for your event participation. Download them any time.')}
      </p>
      <div className="divide-y divide-rule">
        {groups.map((g) => (
          <div key={g.id} className="px-5 py-4">
            <h4 className="text-meta-caps">{g.name}</h4>
            <ul className="mt-2 space-y-2">
              {g.invoices.map((inv) => {
                const pill = statusPill(inv);
                const company = inv.registration?.organization_id ? inv.registration.company_name : null;
                return (
                  <li key={inv.id} className="flex items-center gap-3 rounded-card border border-rule bg-white p-3">
                    <span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-field bg-chip text-meta">
                      <FileText className="h-5 w-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15px] font-semibold leading-6 text-navy">{invoiceName(inv)}</p>
                      <p className="text-sm text-meta">
                        {inv.amount_cents != null && <>{(inv.amount_cents / 100).toLocaleString(i18n.language, { minimumFractionDigits: 2 })} {inv.currency || 'EUR'} · </>}
                        {new Date(inv.created_at).toLocaleDateString(i18n.language, { day: 'numeric', month: 'short', year: 'numeric' })}
                        {company && <> · {company}</>}
                      </p>
                    </div>
                    {pill && <StatusPill tone={pill.tone} className="hidden sm:inline-flex">{pill.label}</StatusPill>}
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => download(inv)}
                      disabled={downloading === inv.id}
                      className={cn(BTN_OUTLINE, 'shrink-0 gap-1.5', FOCUS)}
                      aria-label={t('dashboard.invoices.downloadNamed', 'Download {{name}}', { name: invoiceName(inv) })}
                    >
                      {downloading === inv.id
                        ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                        : <Download className="h-4 w-4" aria-hidden="true" />}
                      <span className="hidden sm:inline">{t('dashboard.invoices.download', 'Download')}</span>
                    </Button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </MemberPanel>
  );
}
