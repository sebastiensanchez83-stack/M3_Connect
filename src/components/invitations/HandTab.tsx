import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Copy, Download, ExternalLink, Loader2, MailCheck, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from '@/hooks/use-toast';
import type { InvitationCampaign } from './types';
import type { GlEventLite, GlGuestLite } from './lib/api';
import { guestName, type GuestRow } from './lib/model';
import { emailCopyFor } from './lib/emailCopy';
import { todayIso } from './lib/render';
import { saveBlob } from './lib/sheets';
import {
  INVITATION_HAND_CHANNELS, MARK_SENT_BATCH_MAX, invitationCampaign, invitationChannelLabel, invitationSendLabel,
  type InvitationHandChannel, type InvitationMarkChannel, type InvitationMarkItem,
} from './sendApi';
import { SectionTitle, StatusChip } from './ui';

/* ─── "Send yourself": the invitation from your own mailbox, by post, by phone... ───
 * As for SM26, where invitations often go through Victor's own mailbox: download the ticket and
 * the letter, copy the e-mail, send it yourself, then "Mark as sent". The mark does everything
 * a platform send does except the e-mail (edge function action mark_sent): the guest joins the
 * event's guest list as "invited" (same token, QR and door), the invitation is logged for the
 * health monitor, and the reply is followed in Tracking (Accepted sends the entry pass).
 */

const toSend = (g: GuestRow) => g.status === 'draft' || g.status === 'ready' || g.status === 'not_sent';
type Gone = 'send_uncertain' | 'sent_not_recorded';
/**
 * A platform send that was interrupted and may have gone out (send_uncertain), or that went out
 * without being recorded (sent_not_recorded). Never in a bulk mark: one by one, after checking.
 */
const goneKind = (g: GuestRow): Gone | null =>
  g.r.gl_guest_id && (g.r.send_error === 'send_uncertain' || g.r.send_error === 'sent_not_recorded') ? g.r.send_error : null;
const mayHaveGone = (g: GuestRow) => goneKind(g) !== null;
/** Why "Mark as sent" is not offered for this guest yet (they are fixed in the Guests tab). */
const markBlock = (g: GuestRow): string | null =>
  !g.r.email ? 'Type the e-mail address first (Guests tab): the guest list and the entry pass need it.'
  : g.request && !g.adopt ? 'Asked for an invitation on /wys26: adopt the request in the Guests tab, or leave it to WYS 2026.'
  : g.dups.length ? 'Possible duplicate: choose in the Guests tab first.'
  : null;

const CHANNEL_KEY = 'inv-hand-channel';
const lastChannel = (): InvitationHandChannel => {
  try {
    const v = localStorage.getItem(CHANNEL_KEY);
    if (v && (INVITATION_HAND_CHANNELS as readonly string[]).includes(v)) return v as InvitationHandChannel;
  } catch { /* private window */ }
  return 'email';
};

interface Line { id: string; outcome: InvitationMarkItem['outcome']; code?: string; message?: string }

async function copyText(text: string, what: string) {
  try { await navigator.clipboard.writeText(text); toast({ title: `${what} copied` }); }
  catch { toast({ title: 'Copy is blocked here', description: 'Select the text and press Ctrl+C.', variant: 'destructive' }); }
}

export function HandTab({ campaign, rows, event, guests, reload, onTracking }: {
  campaign: InvitationCampaign; rows: GuestRow[]; event: GlEventLite | null; guests: GlGuestLite[];
  reload: () => Promise<void>; onTracking: () => void;
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [pdfBusy, setPdfBusy] = useState<string | null>(null);
  const [zipping, setZipping] = useState<string | null>(null);
  const [emailId, setEmailId] = useState<string | null>(null);
  const [markIds, setMarkIds] = useState<string[] | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [lastRun, setLastRun] = useState<{ channel: InvitationMarkChannel; sentOn: string | null } | null>(null);

  const todo = useMemo(() => rows.filter(toSend), [rows]);
  const byId = useMemo(() => new Map(rows.map(g => [g.r.id, g])), [rows]);
  const sentCount = rows.length - todo.length;
  const held = guests.filter(g => g.status === 'confirmed' || g.status === 'invited').length;
  const nameOf = (id: string) => guestName(byId.get(id)?.r || { name_on_ticket: 'Guest not in this list', first_name: null, last_name: null });

  useEffect(() => { setPicked(s => new Set([...s].filter(id => todo.some(g => g.r.id === id)))); }, [todo]);
  const toggle = (id: string) => setPicked(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allPicked = todo.length > 0 && todo.every(g => picked.has(g.r.id));
  const pickedRows = todo.filter(g => picked.has(g.r.id));
  // As "Send from the platform" leaves them out of its selection: a send that may have gone out
  // is marked one by one, from its own line, after checking the Resend log.
  const markable = pickedRows.filter(g => !markBlock(g) && !mayHaveGone(g));
  const goneN = pickedRows.filter(g => !markBlock(g) && mayHaveGone(g)).length;

  const downloadOne = async (g: GuestRow) => {
    setPdfBusy(g.r.id);
    try {
      const gen = await import('./lib/generate');
      const res = await gen.downloadGuestPdfs(campaign, g.r);
      if (!res.ok) toast({ title: 'The PDFs of this guest have a problem', description: res.issues.map(i => i.message).join(' '), variant: 'destructive' });
    } catch (e) {
      toast({ title: 'The PDFs could not be made', description: (e as Error).message, variant: 'destructive' });
    } finally { setPdfBusy(null); }
  };

  const zip = async () => {
    const list = pickedRows.map(g => g.r);
    if (!list.length) return;
    setZipping(`0/${list.length}`);
    try {
      const gen = await import('./lib/generate');
      const res = await gen.zipFor(campaign, list, n => setZipping(`${n}/${list.length}`), r => rows.findIndex(g => g.r.id === r.id) + 1, { email: true });
      if (res.blob) saveBlob(res.blob, `${campaign.settings?.file_prefix || 'Invitation'}_To_send.zip`);
      if (res.skipped.length) {
        toast({ title: `${res.skipped.length} guest${res.skipped.length === 1 ? '' : 's'} left out of the ZIP`, description: res.skipped.map(s => `${guestName(s.r)}: ${s.issues[0].message}`).join(' '), variant: 'destructive' });
      } else toast({ title: `ZIP ready: ${res.done} guest${res.done === 1 ? '' : 's'}`, description: 'One folder per guest: the ticket, the letter and the e-mail text.' });
    } catch (e) {
      toast({ title: 'The ZIP could not be made', description: (e as Error).message, variant: 'destructive' });
    } finally { setZipping(null); }
  };

  /** "mark_sent", 25 guests per call, again with "remaining" until it is empty. */
  const runMark = async (ids: string[], channel: InvitationMarkChannel, sentOn: string | null, force = false) => {
    const out: Line[] = [];
    let left = ids;
    setLines([]);
    setLastRun({ channel, sentOn });
    while (left.length) {
      setRunning(`Marking ${out.length + 1} to ${Math.min(ids.length, out.length + Math.min(left.length, MARK_SENT_BATCH_MAX))} of ${ids.length}`);
      const res = await invitationCampaign({
        action: 'mark_sent', campaign_id: campaign.id, recipient_ids: left, channel, sent_on: sentOn,
        adopt: left.filter(id => byId.get(id)?.adopt && byId.get(id)?.request), force_capacity: force || undefined,
      });
      if (!Array.isArray(res.results)) {
        left.forEach(id => out.push({ id, outcome: 'failed', message: `No answer from the server${res.error ? ` (${invitationSendLabel(res.error)})` : ''}. Reload the page and look before trying again.` }));
        break;
      }
      const remaining = new Set(Array.isArray(res.remaining) ? res.remaining : []);
      const got = new Map(res.results.map(x => [x.id, x]));
      for (const id of left) {
        if (remaining.has(id)) continue;
        const x = got.get(id);
        if (!x) { out.push({ id, outcome: 'failed', message: 'No answer for this guest.' }); continue; }
        const why = invitationSendLabel(x.code) + (x.detail && x.code !== 'same_person' && x.code !== 'mark_failed' ? ` (${x.detail})` : '');
        out.push({
          id, outcome: x.outcome, code: x.code,
          message: x.outcome === 'sent'
            ? [
              x.channel === 'platform' && channel !== 'platform' ? 'recorded as the platform e-mail, which went out' : '',
              x.adopted === 'request' ? 'request adopted' : '', x.detail === 'date_not_saved' ? invitationSendLabel('date_not_saved') : '',
            ].filter(Boolean).join(', ') || undefined
            : why,
        });
      }
      setLines([...out]);
      const next = left.filter(id => remaining.has(id));
      if (next.length >= left.length) { next.forEach(id => out.push({ id, outcome: 'skipped', message: 'Not handled by the server: try again.' })); break; }
      left = next;
    }
    setLines([...out]);
    setRunning(null);
    const ok = out.filter(l => l.outcome === 'sent').length;
    toast({
      title: `${ok} invitation${ok === 1 ? '' : 's'} marked as sent`,
      description: out.length > ok ? `${out.length - ok} not marked: see the list.` : 'They are on the guest list as invited. Follow the replies in Tracking.',
      variant: out.length > ok ? 'destructive' : undefined,
    });
    setPicked(new Set());
    await reload();
  };

  const capacityBlocked = lines.filter(l => l.outcome === 'blocked' && l.code === 'capacity').map(l => l.id);
  const emailGuest = emailId ? byId.get(emailId) || null : null;
  const markOne = markIds?.length === 1 ? byId.get(markIds[0]) || null : null;

  return (
    <div className="space-y-6 max-w-5xl">
      <section className="rounded-lg border bg-white p-4 space-y-2">
        <SectionTitle aside={<span className="text-xs text-gray-500">{sentCount} already sent</span>}>Send the invitations yourself</SectionTitle>
        <ol className="list-decimal pl-5 text-sm text-gray-700 space-y-1">
          <li><b>Download the ticket and the letter</b> of a guest (or a ZIP of your selection, with each guest's e-mail text).</li>
          <li><b>Copy the e-mail</b> into Outlook and attach the two PDFs. Or post the letter, call, hand it over.</li>
          <li><b>Mark as sent</b>, with how and when it went. Nothing is e-mailed by the platform: the guest joins the {event?.title || 'event'} guest list as invited, exactly as with a platform send, and you follow the reply in <button type="button" className="underline text-[#0A2E5C]" onClick={onTracking}>Tracking</button>. When they accept, Tracking sends their entry pass (QR).</li>
        </ol>
        <p className="text-xs text-gray-500">Seats held on the event (confirmed and invited, every source): <b>{held}{event?.capacity ? ` of ${event.capacity}` : ''}</b>.</p>
      </section>

      {picked.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border bg-sky-50 px-3 py-2 text-sm">
          <span className="font-medium">{picked.size} selected</span>
          <Button size="sm" variant="outline" disabled={!!zipping} onClick={zip}>
            {zipping ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Download className="h-4 w-4 mr-1" />}{zipping ? `PDFs ${zipping}` : 'Ticket + letter + e-mail (ZIP)'}
          </Button>
          <Button size="sm" disabled={!markable.length || !!running} onClick={() => setMarkIds(markable.map(g => g.r.id))}>
            <MailCheck className="h-4 w-4 mr-1" /> Mark {markable.length} as sent
          </Button>
          {pickedRows.length - markable.length - goneN > 0 && <span className="text-xs text-amber-800">{pickedRows.length - markable.length - goneN} not markable yet (see their line)</span>}
          {goneN > 0 && <span className="text-xs text-amber-800">{goneN} may already have had the platform e-mail: mark {goneN === 1 ? 'it' : 'them'} one by one, from {goneN === 1 ? 'its' : 'their'} line</span>}
          <button type="button" className="ml-auto text-xs text-gray-500 underline" onClick={() => setPicked(new Set())}>Clear</button>
        </div>
      )}

      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-gray-800">To send ({todo.length})</h2>
          {todo.length > 0 && (
            <label className="flex items-center gap-2 text-xs text-gray-600">
              <Checkbox checked={allPicked} onCheckedChange={v => setPicked(v === true ? new Set(todo.map(g => g.r.id)) : new Set())} aria-label="Select every guest to send" />
              Select all
            </label>
          )}
        </div>
        {!todo.length ? (
          <p className="rounded-lg border bg-white p-6 text-center text-sm text-gray-500">
            {rows.length ? 'Every invitation of this campaign has gone out. Follow the replies in Tracking.' : 'No guest yet: add or import them in the Guests tab.'}
          </p>
        ) : (
          <ul className="rounded-lg border bg-white divide-y">
            {todo.map(g => {
              const block = markBlock(g);
              const i = rows.indexOf(g);
              return (
                <li key={g.r.id} className="p-3 grid gap-2 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                  <div className="flex items-start gap-2 min-w-0">
                    <Checkbox className="mt-0.5" checked={picked.has(g.r.id)} onCheckedChange={() => toggle(g.r.id)} aria-label={`Select ${guestName(g.r)}`} />
                    <div className="min-w-0 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[11px] text-gray-400">{String(i + 1).padStart(2, '0')}</span>
                        <span className="font-medium text-gray-900 break-words">{guestName(g.r)}</span>
                        <StatusChip status={g.status} />
                      </div>
                      <div className="text-xs text-gray-500 break-all">{[g.r.organisation, g.r.email || 'no e-mail address'].filter(Boolean).join(' · ')}</div>
                      {block && <div className="mt-0.5 text-xs text-amber-800 flex gap-1"><AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" />{block}</div>}
                      {g.request && g.adopt && <div className="mt-0.5 text-xs text-purple-800">Request from /wys26 adopted: marking it invites that same guest-list row.</div>}
                      {goneKind(g) === 'send_uncertain' && <div className="mt-0.5 text-xs text-amber-800">A platform send was interrupted and may have gone. Check the Resend log first: if the e-mail is there, "Mark as sent" with "Platform e-mail" records it; if not, send it yourself.</div>}
                      {goneKind(g) === 'sent_not_recorded' && <div className="mt-0.5 text-xs text-amber-800">The platform e-mail went out but was not recorded: do not send it again. "Mark as sent" only records it, as the platform e-mail.</div>}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5 pl-6 md:pl-0">
                    <Button size="sm" variant="outline" disabled={pdfBusy === g.r.id} onClick={() => downloadOne(g)}>
                      {pdfBusy === g.r.id ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Download className="h-4 w-4 mr-1" />}Ticket + letter
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setEmailId(g.r.id)}><Copy className="h-4 w-4 mr-1" /> Copy the e-mail</Button>
                    <Button size="sm" disabled={!!block || !!running} onClick={() => setMarkIds([g.r.id])}>
                      <MailCheck className="h-4 w-4 mr-1" /> Mark as sent
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {running && <p className="text-sm text-gray-700 flex items-center gap-2" aria-live="polite"><Loader2 className="h-4 w-4 animate-spin" />{running}</p>}

      {lines.length > 0 && (
        <section className="rounded-lg border bg-white p-4 space-y-2" aria-live="polite">
          <SectionTitle>Last marking{lastRun ? `: ${invitationChannelLabel(lastRun.channel)}` : ''}</SectionTitle>
          <ul className="divide-y text-sm">
            {lines.map(l => (
              <li key={l.id} className="py-1.5 flex flex-wrap items-center gap-2">
                {l.outcome === 'sent' ? <CheckCircle2 className="h-4 w-4 text-green-700" /> : <XCircle className="h-4 w-4 text-red-700" />}
                <span className="font-medium">{nameOf(l.id)}</span>
                <span className={l.outcome === 'sent' ? 'text-green-800' : 'text-red-800'}>{l.outcome === 'sent' ? `Marked as sent${l.message ? `, ${l.message}` : ''}` : l.message || 'Not marked'}</span>
              </li>
            ))}
          </ul>
          {capacityBlocked.length > 0 && lastRun && (
            <Button size="sm" variant="outline" className="text-amber-800" disabled={!!running}
              onClick={() => {
                if (!confirm(`Mark ${capacityBlocked.length} more as sent over the event capacity? Confirmed guests and invitations awaiting an answer already fill it.`)) return;
                runMark(capacityBlocked, lastRun.channel, lastRun.sentOn, true);
              }}>
              Mark the {capacityBlocked.length} blocked by the capacity anyway
            </Button>
          )}
        </section>
      )}

      <EmailDialog campaign={campaign} g={emailGuest} onClose={() => setEmailId(null)}
        onDownload={downloadOne} busy={!!emailGuest && pdfBusy === emailGuest.r.id}
        onMark={emailGuest && !markBlock(emailGuest) ? () => { const id = emailGuest.r.id; setEmailId(null); setMarkIds([id]); } : null} />
      <MarkDialog ids={markIds} nameOf={nameOf} eventTitle={event?.title || 'event'} onClose={() => setMarkIds(null)}
        gone={markOne ? goneKind(markOne) : null}
        onConfirm={(channel, sentOn) => { const ids = markIds || []; setMarkIds(null); if (ids.length) runMark(ids, channel, sentOn); }} />
    </div>
  );
}

/* ─── The e-mail of one guest, to paste in your own mailbox ─── */

function EmailDialog({ campaign, g, onClose, onDownload, busy, onMark }: {
  campaign: InvitationCampaign; g: GuestRow | null; onClose: () => void; onDownload: (g: GuestRow) => void; busy: boolean; onMark: (() => void) | null;
}) {
  const m = useMemo(() => (g ? emailCopyFor(campaign, g.r) : null), [campaign, g]);
  const label = 'text-[10.5px] uppercase tracking-wider text-gray-500 font-semibold';
  return (
    <Dialog open={!!g} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="w-[calc(100vw-1rem)] max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="pr-6 break-words">E-mail for {g ? guestName(g.r) : ''}</DialogTitle></DialogHeader>
        {g && m && (
          <div className="space-y-3 text-sm min-w-0">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0"><div className={label}>To</div><div className="break-all">{m.to || <span className="text-amber-700">No e-mail address yet: type it in the Guests tab.</span>}</div></div>
              {m.to && <Button size="sm" variant="outline" onClick={() => copyText(m.to, 'Address')}><Copy className="h-4 w-4 mr-1" /> Copy</Button>}
            </div>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0"><div className={label}>Subject</div><div className="font-semibold break-words">{m.subject}</div></div>
              <Button size="sm" variant="outline" onClick={() => copyText(m.subject, 'Subject')}><Copy className="h-4 w-4 mr-1" /> Copy</Button>
            </div>
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                <div className={label}>Text</div>
                <Button size="sm" onClick={() => copyText(m.body, 'E-mail text')}><Copy className="h-4 w-4 mr-1" /> Copy the e-mail text</Button>
              </div>
              <pre className="whitespace-pre-wrap break-words font-sans text-sm rounded-md border bg-gray-50 p-3 max-h-72 overflow-y-auto">{m.body}</pre>
            </div>
            {m.unknown.length > 0 && <p role="alert" className="text-sm text-red-700">Unknown variable{m.unknown.length === 1 ? '' : 's'} {m.unknown.join(' ')}: fix the e-mail text in Settings before sending it.</p>}
            <div className="flex flex-wrap items-center gap-2 border-t pt-3">
              <Button size="sm" variant="outline" disabled={busy} onClick={() => onDownload(g)}>
                {busy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Download className="h-4 w-4 mr-1" />}Ticket + letter (2 PDFs)
              </Button>
              {m.mailto && m.to && (
                <a href={m.mailto} className="inline-flex items-center gap-1 text-sm text-[#0A2E5C] underline">
                  <ExternalLink className="h-4 w-4" /> Open in my mail program
                </a>
              )}
              {onMark && <Button size="sm" className="sm:ml-auto" onClick={onMark}><MailCheck className="h-4 w-4 mr-1" /> Mark as sent</Button>}
            </div>
            <p className="text-xs text-gray-500">A mail program opened from here gets the address, the subject and the text, not the attachments: attach the two PDFs yourself.</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ─── How and when it went ─── */

function MarkDialog({ ids, nameOf, eventTitle, gone, onClose, onConfirm }: {
  ids: string[] | null; nameOf: (id: string) => string; eventTitle: string;
  /** The one guest marked here had a platform send interrupted (it may have gone, or went out unrecorded). */
  gone: Gone | null;
  onClose: () => void;
  onConfirm: (channel: InvitationMarkChannel, sentOn: string | null) => void;
}) {
  const [channel, setChannel] = useState<InvitationMarkChannel>('email');
  const [date, setDate] = useState(todayIso());
  useEffect(() => { if (ids) { setChannel(gone === 'sent_not_recorded' ? 'platform' : lastChannel()); setDate(todayIso()); } }, [ids, gone]);
  const today = todayIso();
  const n = ids?.length || 0;
  const bad = !!date && date > today;
  const channels: InvitationMarkChannel[] = gone === 'sent_not_recorded' ? ['platform'] : gone ? ['platform', ...INVITATION_HAND_CHANNELS] : [...INVITATION_HAND_CHANNELS];
  const confirm = () => {
    if (channel !== 'platform') { try { localStorage.setItem(CHANNEL_KEY, channel); } catch { /* private window */ } }
    onConfirm(channel, !date || date === today ? null : date);
  };
  const names = (ids || []).slice(0, 6).map(nameOf);
  return (
    <Dialog open={!!ids} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="w-[calc(100vw-1rem)] max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="pr-6 break-words">{n === 1 ? `Mark ${nameOf(ids![0])} as sent` : `Mark ${n} invitations as sent`}</DialogTitle></DialogHeader>
        <div className="space-y-3 text-sm">
          <p className="text-gray-600">Nothing is e-mailed by the platform. {n === 1 ? 'The guest joins' : 'Each guest joins'} the {eventTitle} guest list as invited (same QR and door as every guest) and the reply is followed in Tracking.</p>
          {n > 1 && <p className="text-gray-700 break-words">{names.join(', ')}{n > names.length ? `, and ${n - names.length} more` : ''}.</p>}
          {gone === 'send_uncertain' && (
            <p className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">A platform send of this invitation was interrupted and may have gone. Look in the Resend log first: if the e-mail is there, choose "Platform e-mail" (do not send it again); if not, choose how you sent it.</p>
          )}
          {gone === 'sent_not_recorded' && (
            <p className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">The platform e-mail of this invitation went out but was not recorded. This only records it, as the platform e-mail: do not send it again.</p>
          )}
          <label className="block"><span className="block text-xs font-medium text-gray-600 mb-1">How it went</span>
            <select className="border rounded-md h-10 px-2 bg-white w-full disabled:opacity-70" value={channel} disabled={channels.length === 1}
              onChange={e => setChannel(e.target.value as InvitationMarkChannel)}>
              {channels.map(c => <option key={c} value={c}>{c === 'platform' ? 'Platform e-mail (it went out)' : invitationChannelLabel(c)}</option>)}
            </select>
          </label>
          <label className="block"><span className="block text-xs font-medium text-gray-600 mb-1">Sent on</span>
            <input type="date" className="border rounded-md h-10 px-2 bg-white w-full" value={date} max={today} onChange={e => setDate(e.target.value)} aria-invalid={bad} />
          </label>
          {bad && <p className="text-xs text-red-700">The date is in the future.</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button disabled={bad || !n} onClick={confirm}><MailCheck className="h-4 w-4 mr-1" /> {n === 1 ? 'Mark as sent' : `Mark ${n} as sent`}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
