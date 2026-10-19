import { useMemo, useState } from 'react';
import { Copy, Download, Loader2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import type { InvitationAnswer, InvitationCampaign } from './types';
import type { GlEventLite, GlGuestLite } from './lib/api';
import { invitationCampaign, invitationChannelLabel, invitationSendLabel } from './sendApi';
import { daysSince, daysUntil, guestName, needsReminder, STATUS_LABEL, type DisplayStatus, type GuestRow } from './lib/model';
import { dateLabel } from './lib/render';
import { csvBlob, saveBlob, writeXlsx } from './lib/sheets';
import { SectionTitle, StatusChip } from './ui';

const ORDER: DisplayStatus[] = ['draft', 'ready', 'sent', 'accepted', 'declined', 'no_answer'];
/** Shown only when someone is in them, so the tiles always add up to the campaign's guests. */
const RARE: DisplayStatus[] = ['not_sent', 'cancelled', 'refused'];
const SHORT: Partial<Record<DisplayStatus, string>> = {
  sent: 'Awaiting answer', no_answer: 'No reply', not_sent: 'On the list, e-mail not sent',
  cancelled: 'Cancelled in WYS 2026', refused: 'Refused in WYS 2026',
};
const ANSWER_ERRORS: Record<string, string> = {
  not_linked: 'This guest was never sent the invitation (not on the guest list yet).',
  guest_answered: 'The guest has already answered on the guest list.',
  capacity: 'No seat left on the event: free a seat first.',
  guest_cancelled: 'Cancelled on the guest list (WYS 2026).',
  guest_rejected: 'Refused on the guest list (WYS 2026).',
  guest_requested: 'Still a pending request on the guest list.',
};
/** The reply, as the SM26 invitations name it (the guest list is the truth: a guest may answer on their page). */
const REPLY: Partial<Record<DisplayStatus, { label: string; cls: string }>> = {
  sent: { label: 'Awaiting', cls: 'bg-blue-50 text-blue-800 border-blue-200' },
  accepted: { label: 'Accepted', cls: 'bg-green-50 text-green-700 border-green-200' },
  declined: { label: 'Declined', cls: 'bg-red-50 text-red-700 border-red-200' },
  no_answer: { label: 'No reply', cls: 'bg-orange-50 text-orange-800 border-orange-200' },
  cancelled: { label: 'Cancelled in WYS 2026', cls: 'bg-gray-50 text-gray-500 border-gray-200' },
  refused: { label: 'Refused in WYS 2026', cls: 'bg-gray-50 text-gray-500 border-gray-200' },
  not_sent: { label: 'Not recorded as sent', cls: 'bg-amber-50 text-amber-800 border-amber-200' },
};
type ReplyFilter = 'all' | 'sent' | 'accepted' | 'declined' | 'no_answer';
const REPLY_FILTERS: { key: ReplyFilter; label: string }[] = [
  { key: 'all', label: 'Everyone' }, { key: 'sent', label: 'Awaiting' }, { key: 'accepted', label: 'Accepted' },
  { key: 'declined', label: 'Declined' }, { key: 'no_answer', label: 'No reply' },
];
const answerError = (code?: string) => (code ? ANSWER_ERRORS[code] || invitationSendLabel(code) : 'No answer from the server.');
const fmt = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '');

export function TrackingTab({ campaign, rows, event, guests, reload }: {
  campaign: InvitationCampaign; rows: GuestRow[]; event: GlEventLite | null; guests: GlGuestLite[]; reload: () => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState<ReplyFilter>('all');
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const g of rows) c[g.status] = (c[g.status] || 0) + 1;
    return c;
  }, [rows]);
  const left = daysUntil(campaign.rsvp_deadline);
  const held = guests.filter(g => g.status === 'confirmed' || g.status === 'invited').length;
  const reminders = rows.filter(g => needsReminder(g, campaign.rsvp_deadline));
  const followed = rows.filter(g => !['draft', 'ready'].includes(g.status));
  const shown = filter === 'all' ? followed : followed.filter(g => g.status === filter);
  const byHand = followed.filter(g => g.channel && g.channel !== 'platform').length;

  const answer = async (g: GuestRow, a: InvitationAnswer) => {
    const name = guestName(g.r);
    const ask = a === 'accepted'
      ? `Mark ${name} as accepted? They become confirmed on the guest list and receive their entry pass (QR) by e-mail.`
      : a === 'declined' ? `Mark ${name} as declined? Their seat is released and no e-mail is sent.` : `Mark ${name} as "no reply"? They keep their seat; no e-mail is sent.`;
    if (!confirm(ask)) return;
    setBusy(g.r.id);
    const res = await invitationCampaign({ action: 'set_answer', campaign_id: campaign.id, recipient_id: g.r.id, answer: a });
    setBusy(null);
    if (res.error || res.ok === false) { toast({ title: 'Not changed', description: answerError(res.error), variant: 'destructive' }); await reload(); return; }
    toast({
      title: `${name}: ${STATUS_LABEL[a === 'accepted' ? 'accepted' : a === 'declined' ? 'declined' : 'no_answer']}`,
      description: a !== 'accepted' ? undefined
        : res.pass?.sent === false ? `The entry pass was NOT sent (${res.pass.error || 'error'}): use "Send the entry pass".`
        : res.pass?.sent ? 'The entry pass (QR) is on its way.' : 'The entry pass had already been sent.',
      variant: res.pass?.sent === false ? 'destructive' : undefined,
    });
    await reload();
  };

  // A confirmed guest whose pass did not go: "accepted" again sends it (guest-list "resend").
  const sendPass = async (g: GuestRow) => {
    setBusy(g.r.id);
    const res = await invitationCampaign({ action: 'set_answer', campaign_id: campaign.id, recipient_id: g.r.id, answer: 'accepted' });
    setBusy(null);
    if (res.error || res.ok === false || res.pass?.sent === false) {
      toast({ title: 'The entry pass was not sent', description: res.pass?.error || answerError(res.error), variant: 'destructive' });
    } else toast({ title: res.pass?.sent ? 'Entry pass sent' : 'The entry pass had already been sent' });
    await reload();
  };

  const resend = async (g: GuestRow) => {
    const hand = !!g.channel && g.channel !== 'platform';
    if (!confirm(hand
      ? `E-mail the invitation to ${guestName(g.r)} (${g.r.email}) from the platform? It went out before (${invitationChannelLabel(g.channel)}); they now also receive the platform e-mail with the ticket and the letter.`
      : `Send the invitation to ${guestName(g.r)} (${g.r.email}) again? They receive the same e-mail, ticket and letter a second time.`)) return;
    setBusy(g.r.id);
    try {
      const gen = await import('./lib/generate');
      const prep = await gen.prepareForSending(campaign, g.r);
      if (!prep.ok) { toast({ title: 'The PDFs of this guest have a problem', description: prep.issues.map(i => i.message).join(' '), variant: 'destructive' }); return; }
      const res = await invitationCampaign({ action: 'resend', campaign_id: campaign.id, recipient_id: g.r.id });
      if (res.error || res.ok === false) {
        toast({ title: 'Not sent again', description: invitationSendLabel(res.result?.code || res.error) + (res.result?.detail ? ` (${res.result.detail})` : ''), variant: 'destructive' });
      } else toast({ title: 'Invitation sent again' });
      await reload();
    } finally { setBusy(null); }
  };

  const confirmed = rows.filter(g => g.status === 'accepted');
  const exportRows = () => [
    ['Title', 'First name', 'Surname', 'Name on ticket', 'Job title', 'Organisation', 'Country', 'E-mail', 'Phone', 'Answered on', 'Checked in'],
    ...confirmed.map(g => [g.r.honorific, g.r.first_name, g.r.last_name, g.r.name_on_ticket, g.r.position, g.r.organisation, g.r.country,
      g.r.email, g.r.phone, (g.guest?.responded_at || g.r.responded_at || '').slice(0, 10), g.guest?.checked_in_at ? 'yes' : '']),
  ];
  const base = `${(campaign.settings?.file_prefix || 'Invitation')}_confirmed_${new Date().toISOString().slice(0, 10)}`;

  return (
    <div className="space-y-6">
      <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-[repeat(auto-fit,minmax(7.5rem,1fr))] gap-3">
        {[...ORDER, ...RARE.filter(s => counts[s])].map(s => (
          <div key={s} className="rounded-lg border bg-white p-3 text-center">
            <div className="text-2xl font-bold">{counts[s] || 0}</div>
            <div className="text-[11px] uppercase tracking-wide text-gray-500">{SHORT[s] || STATUS_LABEL[s]}</div>
          </div>
        ))}
        <div className="rounded-lg border bg-white p-3 text-center col-span-2 sm:col-span-1">
          <div className="text-2xl font-bold">{left === null ? '-' : left >= 0 ? left : 0}</div>
          <div className="text-[11px] uppercase tracking-wide text-gray-500">
            {left === null ? 'No RSVP deadline' : left > 0 ? `Days left, RSVP ${dateLabel(campaign.rsvp_deadline)}` : left === 0 ? 'RSVP deadline today' : `Deadline passed ${-left} day${left === -1 ? '' : 's'} ago`}
          </div>
        </div>
      </section>
      <p className="text-sm text-gray-600">
        Answers are read from the {event?.title || 'event'} guest list, where a guest may also answer on their personal page.
        Seats held on the event (confirmed and awaiting an answer, every source): <b>{held}{event?.capacity ? ` of ${event.capacity}` : ''}</b>.
        {(counts.not_sent || 0) > 0 && <> {counts.not_sent} guest{counts.not_sent === 1 ? ' is' : 's are'} on the guest list without a recorded e-mail: the note on their line below says what to do.</>}
      </p>

      <section className="rounded-lg border bg-white p-4">
        <SectionTitle aside={reminders.length > 0 && (
          <Button size="sm" variant="outline" onClick={async () => {
            try { await navigator.clipboard.writeText(reminders.map(g => g.r.email).filter(Boolean).join('; ')); toast({ title: 'Addresses copied' }); }
            catch { toast({ title: 'Copy is blocked here', variant: 'destructive' }); }
          }}><Copy className="h-4 w-4 mr-1" /> Copy their addresses</Button>)}>
          Reminders to do ({reminders.length})
        </SectionTitle>
        {reminders.length === 0 ? <p className="text-sm text-gray-500">Nobody to remind: no invitation is waiting for more than a week, and the deadline is not close.</p> : (
          <ul className="divide-y text-sm">
            {reminders.map(g => (
              <li key={g.r.id} className="py-2 flex flex-wrap gap-x-3 gap-y-1">
                <span className="font-medium">{guestName(g.r)}</span>
                <span className="text-gray-500 break-all">{g.r.email}</span>
                <span className="text-gray-500">sent {fmt(g.r.sent_at || g.guest?.invited_at)} ({daysSince(g.r.sent_at || g.guest?.invited_at)} days ago)</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-lg border bg-white p-4">
        <SectionTitle aside={
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={!confirmed.length} onClick={() => saveBlob(csvBlob(exportRows()), `${base}.csv`)}><Download className="h-4 w-4 mr-1" /> Confirmed, CSV</Button>
            <Button size="sm" variant="outline" disabled={!confirmed.length} onClick={async () => saveBlob(await writeXlsx(exportRows(), 'Confirmed'), `${base}.xlsx`)}><Download className="h-4 w-4 mr-1" /> Confirmed, Excel</Button>
          </div>}>
          Answers ({followed.length})
        </SectionTitle>
        {followed.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2" role="group" aria-label="Show">
            {REPLY_FILTERS.map(f => {
              const n = f.key === 'all' ? followed.length : followed.filter(g => g.status === f.key).length;
              return (
                <button key={f.key} type="button" aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}
                  className={`rounded-full border px-3 py-1 text-xs ${filter === f.key ? 'bg-[#0A2E5C] text-white border-[#0A2E5C]' : 'bg-white text-gray-700 hover:border-[#5E9CC4]'}`}>
                  {f.label} ({n})
                </button>
              );
            })}
            {byHand > 0 && <span className="self-center text-xs text-gray-500 ml-1">{byHand} sent outside the platform</span>}
          </div>
        )}
        {!followed.length ? <p className="text-sm text-gray-500">No invitation sent yet.</p> : !shown.length ? <p className="text-sm text-gray-500">Nobody in this view.</p> : (
          <ul className="divide-y">
            <li aria-hidden className="hidden lg:grid lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,0.9fr)_minmax(0,1.5fr)] gap-3 pb-2 text-[10.5px] uppercase tracking-wider text-gray-400">
              <span>Guest</span><span>Invited</span><span>Reply</span><span className="text-right">Actions</span>
            </li>
            {shown.map(g => (
              <li key={g.r.id} className="py-3 grid gap-2 lg:gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,0.9fr)_minmax(0,1.5fr)] items-center text-sm">
                <div className="min-w-0">
                  <div className="font-medium break-words">{guestName(g.r)}</div>
                  <div className="text-xs text-gray-500 break-all">{[g.r.organisation, g.r.email].filter(Boolean).join(' · ')}</div>
                </div>
                <div className="min-w-0 flex flex-wrap items-center gap-x-2 gap-y-1">
                  {g.status === 'not_sent'
                    ? <span className="text-xs text-amber-800">{g.r.send_error ? invitationSendLabel(g.r.send_error) : 'On the guest list, invitation not recorded'}</span>
                    : <>
                      <span className={`inline-block text-xs rounded border px-2 py-0.5 ${g.channel && g.channel !== 'platform' ? 'bg-gray-50 text-gray-700 border-gray-200' : 'bg-sky-50 text-sky-800 border-sky-200'}`}>
                        {g.channel ? invitationChannelLabel(g.channel) : 'Sent'}
                      </span>
                      {(g.r.sent_at || g.guest?.invited_at) && <span className="text-xs text-gray-500">{fmt(g.r.sent_at || g.guest?.invited_at)}</span>}
                    </>}
                </div>
                <div className="min-w-0 flex flex-wrap items-center gap-x-2 gap-y-1">
                  {REPLY[g.status]
                    ? <span className={`inline-block text-xs rounded border px-2 py-0.5 ${REPLY[g.status]!.cls}`}>{REPLY[g.status]!.label}</span>
                    : <StatusChip status={g.status} />}
                  {(g.guest?.responded_at || g.r.responded_at) && g.status !== 'sent' && <span className="text-xs text-gray-500">{fmt(g.guest?.responded_at || g.r.responded_at)}</span>}
                  {g.status === 'accepted' && <span className={`text-xs ${g.passSent ? 'text-green-700' : 'text-amber-700'}`}>{g.passSent ? 'Entry pass sent' : 'Entry pass not sent yet'}</span>}
                  {g.guest?.checked_in_at && <span className="text-xs text-green-700">Checked in</span>}
                </div>
                <div className="flex flex-wrap gap-1.5 lg:justify-end">
                  {busy === g.r.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <>
                    {g.r.gl_guest_id && g.status !== 'accepted' && g.status !== 'cancelled' && g.status !== 'refused' && <Button size="sm" variant="outline" onClick={() => answer(g, 'accepted')}>Accepted</Button>}
                    {g.status === 'accepted' && !g.passSent && <Button size="sm" variant="outline" onClick={() => sendPass(g)}>Send the entry pass</Button>}
                    {g.status !== 'declined' && g.status !== 'cancelled' && g.status !== 'refused' && <Button size="sm" variant="outline" onClick={() => answer(g, 'declined')}>Declined</Button>}
                    {g.status === 'sent' && <Button size="sm" variant="outline" onClick={() => answer(g, 'no_answer')}>No reply</Button>}
                    {(g.status === 'sent' || g.status === 'no_answer') && g.r.email && <Button size="sm" variant="ghost" onClick={() => resend(g)}><RotateCcw className="h-4 w-4 mr-1" /> {g.channel && g.channel !== 'platform' ? 'E-mail it from the platform' : 'Resend'}</Button>}
                    {/* Sending was interrupted: only an explicit resend, once staff checked the Resend log or asked the guest. */}
                    {g.status === 'not_sent' && g.r.send_error === 'send_uncertain' && g.r.email && <Button size="sm" variant="ghost" onClick={() => resend(g)}><RotateCcw className="h-4 w-4 mr-1" /> Resend (it is not in the Resend log)</Button>}
                  </>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
