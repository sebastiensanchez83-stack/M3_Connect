import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, Mail, Send, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { toast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import type { InvitationCampaign } from './types';
import { campaignFn, type GlEventLite } from './lib/api';
import { guestName, type GuestRow } from './lib/model';
import { SectionTitle, StatusChip } from './ui';

const BATCH = 10;

interface Listed { id: string; reason?: string }
interface CheckResult { sendable: number | null; withoutEmail: Listed[] | number; blocked: Listed[] | number; seatsLeft: number | null; capacity: number | null }
interface SendResult { id: string; ok: boolean; message?: string }

const list = (x: unknown): Listed[] | number => {
  if (typeof x === 'number') return x;
  if (Array.isArray(x)) {
    return x.map(i => (typeof i === 'string' ? { id: i }
      : { id: String((i as Record<string, unknown>).recipient_id ?? (i as Record<string, unknown>).id ?? ''), reason: String((i as Record<string, unknown>).reason ?? (i as Record<string, unknown>).error ?? '') || undefined }));
  }
  if (x && typeof x === 'object') return Object.values(x as Record<string, unknown>).reduce<number>((s, v) => s + (typeof v === 'number' ? v : Array.isArray(v) ? v.length : 0), 0);
  return 0;
};
const count = (x: Listed[] | number) => (typeof x === 'number' ? x : x.length);
const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : null);

/** Reads the send lane's preview_send answer, whatever exact shape it settles on. */
function readCheck(raw: Record<string, unknown>): CheckResult {
  const c = (raw.counts as Record<string, unknown>) || raw;
  return {
    sendable: num(c.sendable) ?? (Array.isArray(c.sendable) ? c.sendable.length : null),
    withoutEmail: list(c.without_email ?? c.no_email ?? []),
    blocked: list(c.blocked ?? []),
    seatsLeft: num(c.seats_left),
    capacity: num(c.capacity),
  };
}

const REASON: Record<string, string> = {
  duplicate: 'already invited (same e-mail)', already_on_list: 'already on the guest list', guest_linked_elsewhere: 'invited by another campaign',
  pending_request: 'asked on /wys26: adopt the request first (Guests tab) or leave it to WYS 2026', capacity: 'no seat left',
  no_email: 'no e-mail address', missing_name: 'first name or surname missing', bad_status: 'already sent or answered',
  campaign_archived: 'campaign archived', not_adoptable: 'their guest-list row was refused or cancelled',
};
const reasonText = (r?: string) => (r ? REASON[r] || r.replace(/_/g, ' ') : '');

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
  const [check, setCheck] = useState<CheckResult | null>(null);
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
  useEffect(() => { setCheck(null); }, [picked]);

  const toggle = (id: string) => setPicked(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const testGuest = byId.get(testId) || null;

  const sendTest = async () => {
    if (!testGuest) return;
    setTestBusy(true);
    try {
      const gen = await import('./lib/generate');
      const prep = await gen.prepareForSending(campaign, testGuest.r);
      if (!prep.ok) { toast({ title: 'The PDFs of this guest have a problem', description: prep.issues.map(i => i.message).join(' '), variant: 'destructive' }); return; }
      const res = await campaignFn<{ ok?: boolean; to?: string }>({ action: 'test', campaign_id: campaign.id, recipient_id: testGuest.r.id });
      if (res.error || res.ok === false) { toast({ title: 'The test was not sent', description: res.message || res.error, variant: 'destructive' }); return; }
      const at = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      setTestedAt(at);
      try { sessionStorage.setItem(storeKey, at); } catch { /* private window */ }
      toast({ title: 'Test sent', description: `To ${res.to || user?.email || 'your address'}. Nothing was marked as sent.` });
    } catch (e) {
      toast({ title: 'The test was not sent', description: (e as Error).message, variant: 'destructive' });
    } finally { setTestBusy(false); }
  };

  // Only guests still to send (a guest sent a minute ago stays ticked but is left out).
  const candidateIds = new Set(candidates.map(g => g.r.id));
  const ids = [...picked].filter(id => candidateIds.has(id) && byId.get(id)?.r.email);
  const adoptIds = ids.filter(id => byId.get(id)?.adopt);

  const runCheck = async () => {
    setChecking(true);
    const res = await campaignFn<Record<string, unknown>>({ action: 'preview_send', campaign_id: campaign.id, recipient_ids: ids, adopt: adoptIds });
    setChecking(false);
    if (res.error) { toast({ title: 'The check did not run', description: res.message || res.error, variant: 'destructive' }); return; }
    setCheck(readCheck(res));
  };

  const send = async () => {
    if (!check) return;
    const blockedIds = new Set(typeof check.blocked === 'number' ? [] : check.blocked.map(b => b.id));
    const todo = ids.filter(id => !blockedIds.has(id));
    if (!todo.length) return;
    if (!confirm(`Send ${todo.length} invitation${todo.length === 1 ? '' : 's'} now? Each guest receives one e-mail with their ticket and letter.`)) return;
    const out: SendResult[] = [];
    setResults([]);
    const gen = await import('./lib/generate');
    for (let i = 0; i < todo.length; i += BATCH) {
      const batch = todo.slice(i, i + BATCH);
      const preparedIds: string[] = [];
      for (const id of batch) {
        setProgress({ done: out.length, total: todo.length, phase: `Preparing the PDFs of ${guestName(byId.get(id)!.r)}` });
        try {
          const prep = await gen.prepareForSending(campaign, byId.get(id)!.r);
          if (prep.ok) preparedIds.push(id); else out.push({ id, ok: false, message: prep.issues[0]?.message });
        } catch (e) { out.push({ id, ok: false, message: (e as Error).message }); }
      }
      if (preparedIds.length) {
        setProgress({ done: out.length, total: todo.length, phase: `Sending ${preparedIds.length} invitation${preparedIds.length === 1 ? '' : 's'}` });
        const res = await campaignFn<{ results?: Record<string, unknown>[] }>({
          action: 'send', campaign_id: campaign.id, recipient_ids: preparedIds, force_capacity: force || undefined,
          adopt: preparedIds.filter(id => adoptIds.includes(id)),
        });
        if (res.error && !res.results) {
          preparedIds.forEach(id => out.push({ id, ok: false, message: res.message || res.error }));
          setResults([...out]);
          toast({ title: 'Sending stopped', description: res.message || res.error, variant: 'destructive' });
          break;
        }
        const got = new Map((res.results || []).map(x => [String(x.recipient_id ?? x.id), x]));
        for (const id of preparedIds) {
          const x = got.get(id);
          out.push(x ? { id, ok: x.ok === true || x.status === 'sent', message: reasonText(String(x.error ?? x.reason ?? '')) || undefined } : { id, ok: false, message: 'No answer for this guest' });
        }
      }
      setResults([...out]);
    }
    setProgress(null);
    const ok = out.filter(r => r.ok).length;
    toast({ title: `${ok} invitation${ok === 1 ? '' : 's'} sent`, description: out.length > ok ? `${out.length - ok} not sent: see the list.` : undefined, variant: out.length > ok ? 'destructive' : undefined });
    setCheck(null);
    await reload();
  };

  const canSend = !!check && (testedAt || skipTest) && !progress;
  const overCapacity = !!check && check.seatsLeft !== null && check.sendable !== null && check.sendable > check.seatsLeft;

  return (
    <div className="space-y-6 max-w-4xl">
      <section className="rounded-lg border bg-white p-4 space-y-3">
        <SectionTitle>1. Test first</SectionTitle>
        <p className="text-sm text-gray-600">The test goes to your own address ({user?.email || 'your account e-mail'}) with the real ticket and letter of the guest you pick. Nothing is marked as sent and nobody is added to the guest list.</p>
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
              ['Will be sent', check.sendable ?? '?'], ['Without e-mail', count(check.withoutEmail)], ['Blocked', count(check.blocked)],
              ['Seats left', check.seatsLeft === null ? 'No limit' : `${check.seatsLeft}${check.capacity ?? event?.capacity ? ` of ${check.capacity ?? event?.capacity}` : ''}`],
            ].map(([k, v]) => (
              <div key={k as string} className="rounded-md bg-gray-50 p-2"><dt className="text-[11px] uppercase text-gray-500">{k}</dt><dd className="text-xl font-bold">{v}</dd></div>
            ))}
          </dl>
          {typeof check.withoutEmail !== 'number' && check.withoutEmail.length > 0 && (
            <p className="text-sm text-gray-700">Without e-mail: {check.withoutEmail.map(b => guestName(byId.get(b.id)?.r || { name_on_ticket: b.id, first_name: null, last_name: null })).join(', ')}</p>
          )}
          {typeof check.blocked !== 'number' && check.blocked.length > 0 && (
            <ul className="text-sm text-red-800 space-y-0.5">
              {check.blocked.map(b => <li key={b.id} className="flex gap-1"><XCircle className="h-4 w-4 shrink-0 mt-0.5" />{guestName(byId.get(b.id)?.r || { name_on_ticket: b.id, first_name: null, last_name: null })}: {reasonText(b.reason) || 'blocked'}</li>)}
            </ul>
          )}
          {adoptIds.length > 0 && <p className="text-sm text-purple-800">Requests adopted into this campaign: {adoptIds.map(id => guestName(byId.get(id)!.r)).join(', ')}.</p>}
          {overCapacity && (
            <label className="flex items-start gap-2 text-sm text-amber-800">
              <Checkbox checked={force} onCheckedChange={v => setForce(v === true)} className="mt-0.5" />
              <span>This goes over the event capacity (confirmed guests and invitations awaiting an answer count). Send anyway.</span>
            </label>
          )}
          {!testedAt && (
            <label className="flex items-start gap-2 text-sm text-amber-800">
              <Checkbox checked={skipTest} onCheckedChange={v => setSkipTest(v === true)} className="mt-0.5" />
              <span><AlertTriangle className="inline h-4 w-4 mr-1" />No test sent in this session. I have already checked a test e-mail of this campaign.</span>
            </label>
          )}
          <Button disabled={!canSend || (overCapacity && !force)} onClick={send}>
            <Send className="h-4 w-4 mr-2" />Send now, in batches of {BATCH}
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
                {r.ok ? <CheckCircle2 className="h-4 w-4 text-green-700" /> : <XCircle className="h-4 w-4 text-red-700" />}
                <span className="font-medium">{guestName(byId.get(r.id)?.r || { name_on_ticket: r.id, first_name: null, last_name: null })}</span>
                {!r.ok && <span className="text-red-800">{r.message || 'Not sent'}</span>}
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
