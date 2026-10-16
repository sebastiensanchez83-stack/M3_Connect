import { useEffect, useMemo, useState } from 'react';
import { Copy, Download, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import type { InvitationCampaign, InvitationRecipient, InvitationTicketStyle } from './types';
import { emailFor } from './lib/render';
import { guestName } from './lib/model';
import { saveBlob } from './lib/sheets';
import type { PdfIssue } from './lib/pdf';
import { Issues, PdfCanvas, Segmented } from './ui';

type Tab = 'ticket' | 'letter' | 'email';

/** Ticket, letter and e-mail of one guest, as they will be sent. */
export function PreviewPanel({ campaign, recipient, onStyle, large = false }: {
  campaign: InvitationCampaign;
  recipient: InvitationRecipient | null;
  onStyle?: (s: InvitationTicketStyle) => void;
  large?: boolean;
}) {
  const [tab, setTab] = useState<Tab>(() => {
    try { return (localStorage.getItem('inv-preview-tab') as Tab) || 'ticket'; } catch { return 'ticket'; }
  });
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [issues, setIssues] = useState<PdfIssue[]>([]);
  const [busy, setBusy] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  useEffect(() => { try { localStorage.setItem('inv-preview-tab', tab); } catch { /* private window */ } }, [tab]);

  // Only what changes the PDFs triggers a new render (debounced while typing).
  const key = useMemo(() => JSON.stringify([tab, campaign.ticket_style, campaign.letter_date, campaign.settings, campaign.texts,
    recipient && [recipient.id, recipient.name_on_ticket, recipient.name_on_letter, recipient.greeting, recipient.position, recipient.organisation, recipient.first_name, recipient.last_name]]),
  [tab, campaign, recipient]);

  useEffect(() => {
    if (!recipient || tab === 'email') { setBytes(null); setIssues([]); return; }
    let cancelled = false;
    const t = setTimeout(async () => {
      setBusy(true); setLoadErr(null);
      try {
        const { guestPdfs } = await import('./lib/generate');
        const p = await guestPdfs(campaign, recipient, tab);
        if (cancelled) return;
        const one = tab === 'ticket' ? p.ticket : p.letter;
        setBytes(one.bytes); setIssues(one.issues);
      } catch (e) {
        if (!cancelled) { setBytes(null); setLoadErr((e as Error).message || 'The invitation artwork did not load.'); }
      } finally { if (!cancelled) setBusy(false); }
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const download = async (which: 'ticket' | 'letter') => {
    if (!recipient) return;
    const gen = await import('./lib/generate');
    const p = await gen.guestPdfs(campaign, recipient, which);
    const one = which === 'ticket' ? p.ticket : p.letter;
    if (one.issues.some(i => i.level === 'error')) { setIssues(one.issues); toast({ title: 'Fix the problem shown first', variant: 'destructive' }); return; }
    saveBlob(new Blob([one.bytes as unknown as BlobPart], { type: 'application/pdf' }), which === 'ticket' ? gen.ticketName(campaign, recipient) : gen.letterName(campaign, recipient));
  };

  const mail = recipient ? emailFor(campaign, recipient) : null;
  const copy = async (text: string, what: string) => {
    try { await navigator.clipboard.writeText(text); toast({ title: `${what} copied` }); }
    catch { toast({ title: 'Copy is blocked here', description: 'Select the text and press Ctrl+C.', variant: 'destructive' }); }
  };
  const hasError = issues.some(i => i.level === 'error');

  return (
    <section aria-label="Preview" className="rounded-lg border bg-white p-4 space-y-3 min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-serif italic text-xl text-[#0A2E5C] truncate" style={{ fontFamily: 'Palatino, "Palatino Linotype", "Book Antiqua", Georgia, serif' }}>
            {recipient ? guestName(recipient) : 'No guest selected'}
          </p>
          <p className="text-xs text-gray-500 truncate">{recipient ? [recipient.position, recipient.organisation].filter(Boolean).join(', ') : 'Pick a guest to see the ticket, the letter and the e-mail.'}</p>
        </div>
        {busy && <RefreshCw className="h-4 w-4 animate-spin text-gray-400" aria-label="Drawing" />}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="tablist" aria-label="Preview of" className="flex gap-1 border-b w-full sm:w-auto">
          {(['ticket', 'letter', 'email'] as Tab[]).map(k => (
            <button key={k} role="tab" type="button" aria-selected={tab === k} onClick={() => setTab(k)}
              className={`px-3 py-2 text-sm border-b-2 -mb-px ${tab === k ? 'border-[#0A2E5C] text-gray-900 font-medium' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>
              {k === 'ticket' ? 'Ticket' : k === 'letter' ? 'Letter' : 'E-mail'}
            </button>
          ))}
        </div>
        {tab === 'ticket' && onStyle && (
          <Segmented label="Ticket style" value={campaign.ticket_style} onChange={onStyle}
            options={[{ value: 'white', label: 'White' }, { value: 'navy', label: 'Navy' }]} />
        )}
      </div>
      {!recipient ? null : tab === 'email' && mail ? (
        <div className="space-y-3">
          <div className="rounded-md border bg-gray-50 p-3 text-sm space-y-2">
            <div><div className="text-[10.5px] uppercase tracking-wider text-gray-500 font-semibold">To</div>
              <div className="break-all">{mail.to || <span className="text-amber-700">No e-mail address yet: type it in the table.</span>}</div></div>
            <div><div className="text-[10.5px] uppercase tracking-wider text-gray-500 font-semibold">Subject</div>
              <div className="font-semibold">{mail.subject}</div></div>
            <pre className="whitespace-pre-wrap font-sans text-sm max-w-[70ch]">{mail.body}</pre>
            <div className="text-xs text-gray-500">Attached: {campaign.settings?.file_prefix || 'Invitation'}_Ticket and {campaign.settings?.file_prefix || 'Invitation'}_Letter PDFs.</div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => copy(mail.body, 'E-mail text')}><Copy className="h-4 w-4 mr-1" /> Copy text</Button>
            <Button size="sm" variant="outline" onClick={() => copy(mail.subject, 'Subject')}><Copy className="h-4 w-4 mr-1" /> Copy subject</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {loadErr && <p role="alert" className="text-sm text-red-700">{loadErr}</p>}
          <Issues issues={issues} />
          <PdfCanvas bytes={bytes} label={tab === 'ticket' ? 'Ticket preview' : 'Letter preview'} maxWidth={tab === 'letter' ? (large ? 640 : 520) : (large ? 900 : 700)} />
          <Button size="sm" disabled={busy || hasError || !bytes} onClick={() => download(tab === 'ticket' ? 'ticket' : 'letter')}>
            <Download className="h-4 w-4 mr-1" /> Download {tab === 'ticket' ? 'ticket' : 'letter'} PDF
          </Button>
        </div>
      )}
    </section>
  );
}
