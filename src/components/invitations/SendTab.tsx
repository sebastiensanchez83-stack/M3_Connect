import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, HelpCircle, Loader2, Mail, Send, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { toast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import type { InvitationCampaign } from './types';
import type { GlEventLite } from './lib/api';
import { guestName, type GuestRow } from './lib/model';
import {
  INVITATION_SEND_BATCH, invitationCampaign, invitationSendLabel,
  type InvitationPreviewItem, type InvitationPreviewResult,
} from './sendApi';
import { SectionTitle, StatusChip } from './ui';

const BATCH = INVITATION_SEND_BATCH;

interface SendResult { id: string; outcome: 'sent' | 'skipped' | 'blocked' | 'failed' | 'uncertain'; message?: string }

/** Screen wording of a send code (the sender's labels, a few shorter ones for this list). */
const REASON: Record<string, string> = {
  pending_request: 'asked on /wys26: adopt the request in the Guests tab, or leave it to WYS 2026',
  already_on_list: 'already on the event guest list (invited from WYS 2026): not sent twice',
  capacity: 'no seat left',
};
const reasonText = (code?: string | null, detail?: string | null) => {
  const base = (code && REASON[code]) || invitationSendLabel(code) || '';
  return detail && code !== 'unresolved_variables' ? `${base} (${detail})` : detail ? `${base} ${detail}` : base;
};

/**
 * The confirmation check, as the screens use it. An "existing" adoption (the address became an
 * invited or confirmed guest-list row since Victor chose to adopt its request) is never sent
 * from here: that person already received the guest-list invitation.
 */
function readCheck(res: InvitationPreviewResult) {
  const items = res.recipients.map(i => (i.state === 'sendable' && i.adopt === 'existing'
    ? { ...i, state: 'blocked' as const, code: 'already_on_list' as const, adopt: undefined } : i));
  return {
    raw: res,
    items,
    sendable: items.filter(i => i.state === 'sendable'),
    blocked: items.filter(i => i.state === 'blocked'),
    capacityBlocked: items.filter(i => i.state === 'blocked' && i.code === 'capacity'),
    withoutEmail: items.filter(i => i.state === 'no_email'),
    alreadySent: items.filter(i => i.state === 'already_sent' || i.state === 'in_progress'),
    sameName: items.filter(i => i.same_name?.length),
  };
}
type Check = ReturnType<typeof readCheck>;

export function SendTab({ campaign, rows, event, selectedId, reload }: {
  campaign: InvitationCampaign; rows: GuestRow[]; event: GlEventLite | null; selectedId: string | null; reload: () => Promise<void>;
}) {
  const { user } = useAuth();
  const storeKey = `inv-test-${campaign.id}`;
  const [testId, setTestId] = useState<string>(selectedId || rows[0]?.r.id || '');
  const [testBusy, setTestBusy] = useState(false);
  const [testedAt, setTestedAt] = useState<string | null>(() => { try { return sessionStorage.getItem(storeKey); } catch { return null; } });
  const [skipTest, setSkipTest] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [check, setCheck] = useState<Check | null>(null);
  const [checking, setChecking] = useState(false);
  const [force, setForce] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; phase: string } | null>(null);
  const [results, setResults] = useState<SendResult[]>([]);

  const byId = useMemo(() => new Map(rows.map(g => [g.r.id, g])), [rows]);
  const candidates = rows.filter(g => g.status === 'draft' || g.status === 'ready' || g.status === 'not_sent');
  const ready = candidates.filter(g => g.r.email && (g.r.status === 'ready' || g.status === 'not_sent'));
  const drafts = candidates.filter(g => g.r.email && g.r.status === 'draft' && g.status !== 'not_sent');
  const noEmail = candidates.filter(g => !g.r.email);
  const sentCount = rows.filter(g => !['draft', 'ready', 'not_sent'].includes(g.status)).length;

  // Default selection: every ready guest with an address, except pending /wys26 requests not adopted.
  useEffect(() => {
    setPicked(new Set(ready.filter(g => !g.request || g.adopt).map(g => g.r.id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.length]);
  useEffect(() => { if (!testId && rows[0]) setTestId(rows[0].r.id); }, [rows, testId]);
  useEffect(() => { setCheck(null); setForce(false); }, [picked]);

  const toggle = (id: string) => setPicked(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const testGuest = byId.get(testId) || null;
  const nameOf = (id: string) => guestName(byId.get(id)?.r || { name_on_ticket: 'Guest not in this list', first_name: null, last_name: null });

  const sendTest = async () => {
    if (!testGuest) return;
    setTestBusy(true);
    try {
      const gen = await import('./lib/generate');
      const prep = await gen.prepareForSending(campaign, testGuest.r);
      if (!prep.ok) { toast({ title: 'The PDFs of this guest have a problem', description: prep.issues.map(i => i.message).join(' '), variant: 'destructive' }); return; }
      const res = await invitationCampaign({ action: 'test', campaign_id: campaign.id, recipient_id: testGuest.r.id });
      if (res.error || res.ok === false) { toast({ title: 'The test was not sent', description: reasonText(res.error), variant: 'destructive' }); return; }
      const at = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      setTestedAt(at);
      try { sessionStorage.setItem(storeKey, at); } catch { /* private window */ }
      toast({ title: 'Test sent', description: `To ${res.to || user?.email || 'your address'}, from ${res.from}. Nothing was marked as sent.` });
    } catch (e) {
      toast({ title: 'The test was not sent', description: (e as Error).message, variant: 'destructive' });
    } finally { setTestBusy(false); }
  };

  // Only guests still to send (a guest sent a minute ago stays ticked but is left out).
  const candidateIds = new Set(candidates.map(g => g.r.id));
  const ids = [...picked].filter(id => candidateIds.has(id) && byId.get(id)?.r.email);
  // Victor's per-guest choice (Guests tab), only while the /wys26 request is still pending.
  const adoptIds = ids.filter(id => byId.get(id)?.adopt && byId.get(id)?.request);

  const runCheck = async () => {
    setChecking(true);
    // The PDFs are generated and uploaded per batch right before "send" (always fresh): not checked here.
    const res = await invitationCampaign({ action: 'preview_send', campaign_id: campaign.id, recipient_ids: ids, adopt: adoptIds, pdfs_on_send: true });
    setChecking(false);
    if (res.error || !Array.isArray(res.recipients)) { toast({ title: 'The check did not run', description: reasonText(res.error) || 'No answer.', variant: 'destructive' }); return; }
    setCheck(readCheck(res));
  };

  const send = async () => {
    if (!check) return;
    const go = (i: InvitationPreviewItem) => i.state === 'sendable' || (force && i.state === 'blocked' && i.code === 'capacity');
    const todo = check.items.filter(go).map(i => i.id);
    if (!todo.length) return;
    // Adopt only what the check saw as a pending request.
    const adoptNow = new Set(check.items.filter(i => i.adopt === 'request' || (i.can_adopt === 'request' && adoptIds.includes(i.id))).map(i => i.id));
    if (!confirm(`Send ${todo.length} invitation${todo.length === 1 ? '' : 's'} now? Each guest receives one e-mail with their ticket and letter.`)) return;
    const out: SendResult[] = [];
    setResults([]);
    const gen = await import('./lib/generate');
    for (let i = 0; i < todo.length; i += BATCH) {
      const batch = todo.slice(i, i + BATCH);
      const preparedIds: string[] = [];
      for (const id of batch) {
        setProgress({ done: out.length, total: todo.length, phase: `Preparing the PDFs of ${nameOf(id)}` });
        try {
          // The sender attaches whatever is stored: regenerate from the current row every time.
          const prep = await gen.prepareForSending(campaign, byId.get(id)!.r);
          if (prep.ok) preparedIds.push(id); else out.push({ id, outcome: 'blocked', message: prep.issues[0]?.message });
        } catch (e) { out.push({ id, outcome: 'failed', message: (e as Error).message }); }
      }
      if (preparedIds.length) {
        setProgress({ done: out.length, total: todo.length, phase: `Sending ${preparedIds.length} invitation${preparedIds.length === 1 ? '' : 's'}` });
        const res = await invitationCampaign({
          action: 'send', campaign_id: campaign.id, recipient_ids: preparedIds, force_capacity: force || undefined,
          adopt: preparedIds.filter(id => adoptNow.has(id)),
        });
        if (!Array.isArray(res.results)) {
          preparedIds.forEach(id => out.push({ id, outcome: 'failed', message: reasonText(res.error) || 'No answer from the sender' }));
          setResults([...out]);
          toast({ title: 'Sending stopped', description: reasonText(res.error), variant: 'destructive' });
          break;
        }
        const got = new Map(res.results.map(x => [x.id, x]));
        for (const id of preparedIds) {
          const x = got.get(id);
          out.push(x ? { id, outcome: x.outcome, message: x.outcome === 'sent' ? (x.adopted === 'request' ? 'Request adopted' : undefined) : reasonText(x.code, x.detail) }
            : { id, outcome: 'failed', message: 'No answer for this guest' });
        }
      }
      setResults([...out]);
    }
    setProgress(null);
    const ok = out.filter(r => r.outcome === 'sent').length;
    const unsure = out.filter(r => r.outcome === 'uncertain').length;
    toast({
      title: `${ok} invitation${ok === 1 ? '' : 's'} sent`,
      description: out.length > ok ? `${out.length - ok} not sent${unsure ? ` (${unsure} uncertain: check before resending)` : ''}: see the list.` : undefined,
      variant: out.length > ok ? 'destructive' : undefined,
    });
    setCheck(null);
    await reload();
  };

  const canSend = !!check && (testedAt || skipTest) && !progress;
  const overCapacity = !!check && check.capacityBlocked.length > 0;
  const seats = check?.raw.seats;
  const willSend = check ? check.sendable.length + (force ? check.capacityBlocked.length : 0) : 0;

  return (
    <div className="space-y-6 max-w-4xl">
      <section className="rounded-lg border bg-white p-4 space-y-3">
        <SectionTitle>1. Test first</SectionTitle>
        <p className="text-sm text-gray-600">The test goes to your own address ({user?.email || 'your account e-mail'}) with the real ticket and letter of the guest you pick, and "[Test]" before the subject. Nothing is marked as sent and nobody is added to the guest list.</p>
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label="Guest for the test" className="border rounded-md h-10 px-2 bg-white text-sm max-w-full" value={testId} onChange={e => setTestId(e.target.value)}>
            {rows.map(g => <option key={g.r.id} value={g.r.id}>{guestName(g.r)}</option>)}
          </select>
          <Button disabled={testBusy || !testGuest} onClick={sendTest}>
            {testBusy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Mail className="h-4 w-4 mr-2" />}Send a test to my address
          </Button>
          {testedAt && <span className="text-sm text-green-700 inline-flex items-center gap-1"><CheckCircle2 className="h-4 w-4" />Test sent at {testedAt}</span>}
        </div>
      </section>

      <section className="rounded-lg border bg-white p-4 space-y-3">
        <SectionTitle aside={<span className="text-xs text-gray-500">{sentCount} already sent</span>}>2. Choose who receives the invitation</SectionTitle>
        <p className="text-sm text-gray-600">Guests already sent are never sent again from here; use "Resend" in Tracking. Mark guests ready in the Guests tab once checked.</p>
        <GuestPickList title={`Ready (${ready.length})`} rows={ready} picked={picked} toggle={toggle} />
        {drafts.length > 0 && <GuestPickList title={`Still drafts (${drafts.length})`} rows={drafts} picked={picked} toggle={toggle} note="Not marked ready yet: tick them only if you checked them." />}
        {noEmail.length > 0 && (
          <div className="text-sm">
            <div className="font-medium text-gray-700">Without an e-mail address ({noEmail.length}), type it in the Guests tab:</div>
            <p className="text-gray-600">{noEmail.map(g => guestName(g.r)).join(', ')}</p>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" disabled={!ids.length || checking} onClick={runCheck}>
            {checking && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Check {ids.length} invitation{ids.length === 1 ? '' : 's'} before sending
          </Button>
        </div>
      </section>

      {check && (
        <section className="rounded-lg border-2 border-[#0A2E5C] bg-white p-4 space-y-3" aria-live="polite">
          <SectionTitle>3. Confirm</SectionTitle>
          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
            {[
              ['Will be sent', willSend], ['Without e-mail', check.withoutEmail.length], ['Blocked', check.blocked.length - (force ? check.capacityBlocked.length : 0)],
              ['Seats left', !seats || seats.left === null ? 'No limit' : `${seats.left}${seats.capacity ?? event?.capacity ? ` of ${seats.capacity ?? event?.capacity}` : ''}`],
            ].map(([k, v]) => (
              <div key={k as string} className="rounded-md bg-gray-50 p-2"><dt className="text-[11px] uppercase text-gray-500">{k}</dt><dd className="text-xl font-bold">{v}</dd></div>
            ))}
          </dl>
          <p className="text-xs text-gray-500 break-all">From {check.raw.from}, replies to {check.raw.reply_to}.</p>
          {check.withoutEmail.length > 0 && (
            <p className="text-sm text-gray-700">Without e-mail: {check.withoutEmail.map(b => nameOf(b.id)).join(', ')}</p>
          )}
          {check.alreadySent.length > 0 && (
            <p className="text-sm text-gray-700">Already sent or being sent, left out: {check.alreadySent.map(b => nameOf(b.id)).join(', ')}</p>
          )}
          {check.blocked.length > 0 && (
            <ul className="text-sm text-red-800 space-y-0.5">
              {check.blocked.map(b => <li key={b.id} className="flex gap-1"><XCircle className="h-4 w-4 shrink-0 mt-0.5" /><span><b>{nameOf(b.id)}</b>: {reasonText(b.code, b.code === 'capacity' || b.code === 'needs_explicit_resend' ? null : b.detail) || 'blocked'}</span></li>)}
            </ul>
          )}
          {check.sameName.length > 0 && (
            <p className="text-sm text-amber-800"><AlertTriangle className="inline h-4 w-4 mr-1" />Same name as another guest of the event (sent anyway, check in the Guests tab): {check.sameName.map(b => nameOf(b.id)).join(', ')}.</p>
          )}
          {check.sendable.some(i => i.adopt === 'request') && (
            <p className="text-sm text-purple-800">Requests adopted into this campaign (same guest-list row and QR): {check.sendable.filter(i => i.adopt === 'request').map(i => nameOf(i.id)).join(', ')}.</p>
          )}
          {overCapacity && (
            <label className="flex items-start gap-2 text-sm text-amber-800">
              <Checkbox checked={force} onCheckedChange={v => setForce(v === true)} className="mt-0.5" />
              <span>{check.capacityBlocked.length} guest{check.capacityBlocked.length === 1 ? '' : 's'} would go over the event capacity (confirmed guests and invitations awaiting an answer count). Send to them anyway.</span>
            </label>
          )}
          {!testedAt && (
            <label className="flex items-start gap-2 text-sm text-amber-800">
              <Checkbox checked={skipTest} onCheckedChange={v => setSkipTest(v === true)} className="mt-0.5" />
              <span><AlertTriangle className="inline h-4 w-4 mr-1" />No test sent in this session. I have already checked a test e-mail of this campaign.</span>
            </label>
          )}
          <Button disabled={!canSend || willSend === 0} onClick={send}>
            <Send className="h-4 w-4 mr-2" />Send {willSend} now, in batches of {BATCH}
          </Button>
        </section>
      )}

      {progress && (
        <section className="rounded-lg border bg-white p-4 space-y-2" aria-live="polite">
          <div className="text-sm">{progress.phase}</div>
          <Progress value={(100 * progress.done) / Math.max(1, progress.total)} />
          <div className="text-xs text-gray-500">{progress.done} of {progress.total} done. Keep this page open.</div>
        </section>
      )}

      {results.length > 0 && (
        <section className="rounded-lg border bg-white p-4">
          <SectionTitle>Last sending</SectionTitle>
          <ul className="divide-y text-sm">
            {results.map(r => (
              <li key={r.id} className="py-1.5 flex flex-wrap items-center gap-2">
                {r.outcome === 'sent' ? <CheckCircle2 className="h-4 w-4 text-green-700" /> : r.outcome === 'uncertain' ? <HelpCircle className="h-4 w-4 text-amber-700" /> : <XCircle className="h-4 w-4 text-red-700" />}
                <span className="font-medium">{nameOf(r.id)}</span>
                {r.message && <span className={r.outcome === 'sent' ? 'text-purple-800' : r.outcome === 'uncertain' ? 'text-amber-800' : 'text-red-800'}>{r.message}</span>}
                {!r.message && r.outcome !== 'sent' && <span className="text-red-800">Not sent</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function GuestPickList({ title, rows, picked, toggle, note }: { title: string; rows: GuestRow[]; picked: Set<string>; toggle: (id: string) => void; note?: string }) {
  if (!rows.length) return <p className="text-sm text-gray-500">{title}: nobody.</p>;
  return (
    <div className="space-y-1">
      <div className="text-sm font-medium text-gray-700">{title}</div>
      {note && <p className="text-xs text-gray-500">{note}</p>}
      <ul className="rounded-md border divide-y max-h-80 overflow-y-auto">
        {rows.map(g => (
          <li key={g.r.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
            <Checkbox checked={picked.has(g.r.id)} onCheckedChange={() => toggle(g.r.id)} aria-label={`Send to ${guestName(g.r)}`} />
            <span className="font-medium">{guestName(g.r)}</span>
            <span className="text-gray-500 break-all">{g.r.email}</span>
            <StatusChip status={g.status} />
            {g.request && <span className={`text-xs ${g.adopt ? 'text-purple-800' : 'text-red-700'}`}>{g.adopt ? 'Request adopted' : 'Asked on /wys26: choose in Guests'}</span>}
            {g.dups.length > 0 && <span className="text-xs text-red-700">Possible duplicate</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
