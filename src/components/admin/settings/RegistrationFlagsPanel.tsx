import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { AlertTriangle, Loader2, Power, RefreshCw, ToggleRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/hooks/use-toast';
import { readRegistrationFlags } from '@/lib/flags';
import { cn } from '@/lib/utils';
import { ADMIN_BTN, ADMIN_BTN_DANGER, ADMIN_BTN_PRIMARY, AdminPanel, AdminStatusPill } from '../AdminUI';
import { readSetting, saveSetting } from './settingsStore';

/**
 * The registration switches (platform_settings.registration_flags), each with what it does
 * and what turning it on or off changes, in plain words. Every change asks first; the two
 * that need a runbook (account_signup_v2, capabilities_enforced) also ask to confirm that
 * the runbook was followed. A switch is on only as the JSON boolean true (contract §2): the
 * page writes true / false, keeps every other key of the row as it is, and shows a value of
 * the wrong type as "off (stored as text)".
 */

type Group = 'events' | 'wys' | 'accounts' | 'tools' | 'rights';

interface FlagInfo {
  key: string;
  group: Group;
  title: string;
  what: string;
  on: string;
  off: string;
  /** Shown before turning it ON. */
  warning?: string;
  /** Turning it on needs a ticked "I followed the runbook". */
  runbook?: string;
  /** Read only by the server (no page reads it). */
  serverOnly?: boolean;
}

function flagInfos(t: TFunction): FlagInfo[] {
  return [
    {
      key: 'webinar_v2', group: 'events',
      title: t('adminSettings.flag.webinar.title', 'New webinar registration'),
      what: t('adminSettings.flag.webinar.what', 'Webinars made in the new event editor take registrations on the new event pages: one tap for members, four fields for guests, reminders and the join link.'),
      on: t('adminSettings.flag.webinar.on', 'Event pages show the new registration block; new webinars can be published; reminder e-mails are sent.'),
      off: t('adminSettings.flag.webinar.off', 'Event pages keep today\'s webinar sign-up. Webinars made in the new editor stay drafts or hidden tests.'),
      warning: t('adminSettings.flag.webinar.warn', 'Turn on only once the redesign is the live site: the old site cannot show these registrations.'),
    },
    {
      key: 'onsite_v2', group: 'events',
      title: t('adminSettings.flag.onsite.title', 'New on-site event registration'),
      what: t('adminSettings.flag.onsite.what', 'On-site events made in the new editor take requests that M3 approves. Approving e-mails the entry pass and makes the person\'s account.'),
      on: t('adminSettings.flag.onsite.on', 'These events can be published, and approving a registration e-mails the entry pass.'),
      off: t('adminSettings.flag.onsite.off', 'These events stay drafts or hidden tests, and approving a registration of a real on-site event is refused.'),
      warning: t('adminSettings.flag.onsite.warn', 'Turn on only once the redesign is the live site: entry passes point to the live site\'s door page.'),
    },
    {
      key: 'turnstile', group: 'events',
      title: t('adminSettings.flag.turnstile.title', 'Anti-robot check on registration forms'),
      what: t('adminSettings.flag.turnstile.what', 'Registrations sent without an account must pass the Cloudflare check.'),
      on: t('adminSettings.flag.turnstile.on', 'A registration without an account is refused if the check is missing.'),
      off: t('adminSettings.flag.turnstile.off', 'The check is required only where the server forces it.'),
      warning: t('adminSettings.flag.turnstile.warn', 'Turn on only if the site shows the check (its Cloudflare site key is set). Otherwise every registration without an account is refused.'),
    },
    {
      key: 'wys_form_v2', group: 'wys',
      title: t('adminSettings.flag.wysForm.title', 'WYS request form through the new system'),
      what: t('adminSettings.flag.wysForm.what', 'The /wys26 request form goes through the new registration service: same rules and same e-mails, plus a "View my request" link.'),
      on: t('adminSettings.flag.wysForm.on', 'New WYS requests get a personal link to see their request.'),
      off: t('adminSettings.flag.wysForm.off', 'The /wys26 form sends to the guest list exactly as today.'),
      warning: t('adminSettings.flag.wysForm.warn', 'The WYS pages are frozen from 13 November: change this only with M3\'s go.'),
    },
    {
      key: 'wys_status_edit', group: 'wys',
      title: t('adminSettings.flag.wysEdit.title', 'WYS guests can edit or cancel their request'),
      what: t('adminSettings.flag.wysEdit.what', 'On their personal WYS page, a guest whose request is still under review can change it or cancel it, and a signed-in guest can add it to their account.'),
      on: t('adminSettings.flag.wysEdit.on', 'The "Edit my request" and "Cancel my request" buttons appear while a request waits.'),
      off: t('adminSettings.flag.wysEdit.off', 'The personal WYS page stays as today.'),
      warning: t('adminSettings.flag.wysForm.warn', 'The WYS pages are frozen from 13 November: change this only with M3\'s go.'),
    },
    {
      key: 'front_door', group: 'accounts',
      title: t('adminSettings.flag.frontDoor.title', 'New sign-up and sign-in pages'),
      what: t('adminSettings.flag.frontDoor.what', '"Sign up" first asks "register for an event" or "create my account"; new welcome, password and e-mail confirmation pages; the status card on the dashboard.'),
      on: t('adminSettings.flag.frontDoor.on', 'Everyone signing up or in uses the new pages.'),
      off: t('adminSettings.flag.frontDoor.off', 'Today\'s sign-up and sign-in pages.'),
      warning: t('adminSettings.flag.frontDoor.warn', 'Turn on together with "New account sign-up", or after it.'),
    },
    {
      key: 'account_signup_v2', group: 'accounts',
      title: t('adminSettings.flag.signup.title', 'New account sign-up (company, claims, join requests)'),
      what: t('adminSettings.flag.signup.what', 'The sign-up form asks for the person\'s company: they pick a listed company (a request to its owner, or a claim M3 decides) or declare a new one, which M3 validates in To review. Also "Add my company".'),
      on: t('adminSettings.flag.signup.on', 'New people use the new form; their company requests reach To review (People & companies).'),
      off: t('adminSettings.flag.signup.off', 'Today\'s sign-up form. Requests already stored wait, and run once this is on.'),
      warning: t('adminSettings.flag.signup.warn', 'Before turning this on: "Confirm email" must be ON in Supabase Auth, "Review list v2" must be on (claims and new companies appear only there), and the go-live database file is applied right after. Follow docs/registration-contract.md, sections 10.8 to 10.11.'),
      runbook: 'docs/registration-contract.md §10.8–10.11',
    },
    {
      key: 'password_only_login', group: 'accounts',
      title: t('adminSettings.flag.password.title', 'Sign in with a password only'),
      what: t('adminSettings.flag.password.what', 'The sign-in window stops offering a sign-in link by e-mail; people use their password, or "Forgot password?".'),
      on: t('adminSettings.flag.password.on', 'No more "e-mail me a sign-in link".'),
      off: t('adminSettings.flag.password.off', 'The sign-in link by e-mail is still offered.'),
    },
    {
      key: 'invite_links_v2', group: 'accounts', serverOnly: true,
      title: t('adminSettings.flag.invite.title', 'Signed team invitation links'),
      what: t('adminSettings.flag.invite.what', 'Team invitation e-mails carry a signed link that creates the account straight from the e-mail.'),
      on: t('adminSettings.flag.invite.on', 'With "New account sign-up" also on, new invitations use the new link, which the old site cannot open.'),
      off: t('adminSettings.flag.invite.off', 'Invitation e-mails keep today\'s link.'),
      warning: t('adminSettings.flag.invite.warn', 'Go-live only: the old site cannot open these links.'),
    },
    {
      key: 'review_queue', group: 'tools',
      title: t('adminSettings.flag.queue.title', 'Review list v2'),
      what: t('adminSettings.flag.queue.what', 'To review is sorted by topic (people and companies, event registrations, team joins, duplicates, retro-review), with the validation window for people and their company, and company claims. Approve and Reject in Users use the same window. A summary e-mail goes to the recipients below every day at 08:00.'),
      on: t('adminSettings.flag.queue.on', 'The new review list, the validation window, and the daily summary e-mail.'),
      off: t('adminSettings.flag.queue.off', 'Today\'s review list and today\'s Approve and Reject buttons.'),
      warning: t('adminSettings.flag.queue.warn', 'Needs the Phase 3 database update; until it is applied, the list says it is not available.'),
    },
    {
      key: 'provisioning', group: 'tools',
      title: t('adminSettings.flag.provisioning.title', 'Accounts for confirmed on-site guests'),
      what: t('adminSettings.flag.provisioning.what', 'Every few minutes, each guest confirmed for an on-site event (WYS included) gets a Smart Marina Connect account, or their account is linked, and the "Your account is ready, choose your password" e-mail. For WYS it follows the QR e-mail by about a minute.'),
      on: t('adminSettings.flag.provisioning.on', 'Accounts are made and their e-mails sent, also for every guest confirmed earlier and still waiting.'),
      off: t('adminSettings.flag.provisioning.off', 'Confirmed guests wait in the list; nothing is lost.'),
      warning: t('adminSettings.flag.provisioning.warn', 'The first run e-mails every guest already waiting. Check that list first (docs/registration-contract.md, section 9, "Before switching provisioning on").'),
    },
    {
      key: 'outbox_sender', group: 'tools', serverOnly: true,
      title: t('adminSettings.flag.outbox.title', 'Send the e-mails queued by sign-ups and M3\'s decisions'),
      what: t('adminSettings.flag.outbox.what', 'Sends the e-mails waiting in the database: "account under review", join requests to company owners, and the e-mails of M3\'s decisions (validated, not accepted, a question, claim approved or declined).'),
      on: t('adminSettings.flag.outbox.on', 'These e-mails leave within minutes.'),
      off: t('adminSettings.flag.outbox.off', 'They wait; none is lost or sent twice.'),
      warning: t('adminSettings.flag.outbox.warn', 'Turn on at go-live, with the new notification service.'),
    },
    {
      key: 'capabilities_enforced', group: 'rights',
      title: t('adminSettings.flag.rights.title', 'Rights per company type (go-live switch)'),
      what: t('adminSettings.flag.rights.what', 'The site shows each feature (publish a need, see opportunities, request connections, Deal flow…) according to the type of the person\'s validated company.'),
      on: t('adminSettings.flag.rights.on', 'The site follows the company type. The database rules are a separate step of the runbook.'),
      off: t('adminSettings.flag.rights.off', 'The site follows each person\'s own profile, as today.'),
      warning: t('adminSettings.flag.rights.warn', 'Go-live only, on the day the redesign replaces the old site, together with the held database file. Follow docs/rights-switch-runbook.md. Admin > Rights lists who gains and who loses.'),
      runbook: 'docs/rights-switch-runbook.md',
    },
  ];
}

function groupTitle(g: Group, t: TFunction): string {
  switch (g) {
    case 'events': return t('adminSettings.group.events', 'Events');
    case 'wys': return t('adminSettings.group.wys', 'World Yachting Summit');
    case 'accounts': return t('adminSettings.group.accounts', 'Accounts and sign-in');
    case 'tools': return t('adminSettings.group.tools', 'M3 tools and e-mails');
    case 'rights': return t('adminSettings.group.rights', 'Rights');
  }
}

const GROUPS: Group[] = ['tools', 'events', 'wys', 'accounts', 'rights'];

type Pending = { info: FlagInfo; next: boolean; acknowledged: boolean };

export function RegistrationFlagsPanel() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [value, setValue] = useState<Record<string, unknown> | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [pending, setPending] = useState<Pending | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const infos = flagInfos(t);
  // The window keeps its words while it closes.
  const lastPending = useRef<Pending | null>(null);
  if (pending) lastPending.current = pending;
  const shownPending = pending ?? lastPending.current;

  const load = useCallback(async () => {
    setState(s => (s === 'ready' ? s : 'loading'));
    const row = await readSetting<Record<string, unknown>>('registration_flags');
    if (row.failed) { setState('error'); return; }
    const v = row.value;
    setValue(v && typeof v === 'object' && !Array.isArray(v) ? v : {});
    setUpdatedAt(row.updatedAt);
    setState('ready');
  }, []);

  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    if (!pending || !value) return;
    if (pending.info.runbook && pending.next && !pending.acknowledged) {
      setError(t('adminSettings.confirm.needAck', 'Tick the box once the runbook is followed.'));
      return;
    }
    setSaving(true);
    setError(null);
    // The whole row as read, with this one key set to a JSON boolean: other keys stay as they are.
    const next = { ...value, [pending.info.key]: pending.next };
    const res = await saveSetting('registration_flags', next, updatedAt, user?.id);
    setSaving(false);
    if (!res.ok) {
      if (res.reason === 'conflict') {
        setError(t('adminSettings.conflict', 'Someone changed these switches since you opened the page. The page now shows the current state: check it, then try again.'));
        await load();
      } else {
        setError(t('adminSettings.saveFailed', 'The change could not be saved: {{message}}', { message: res.message ?? '' }));
      }
      return;
    }
    setValue(next);
    setUpdatedAt(res.updatedAt);
    // Every screen of this browser reads the switches again.
    void readRegistrationFlags(true);
    toast({
      title: pending.next
        ? t('adminSettings.done.on', '"{{title}}" is on', { title: pending.info.title })
        : t('adminSettings.done.off', '"{{title}}" is off', { title: pending.info.title }),
      description: t('adminSettings.done.body', 'Visitors see the change within five minutes, or when they reload the page.'),
    });
    setPending(null);
  };

  const known = new Set(infos.map(i => i.key));
  const others = value ? Object.entries(value).filter(([k]) => !known.has(k)) : [];

  return (
    <AdminPanel
      icon={ToggleRight}
      title={t('adminSettings.flags.title', 'Registration switches')}
      description={t('adminSettings.flags.description', 'Each switch turns on one part of the new registration and sign-up. All are off until M3 decides; turning one off goes back to how things were.')}
      actions={
        <Button variant="outline" size="sm" className={cn(ADMIN_BTN, 'h-11')} onClick={() => load()} disabled={state === 'loading'}>
          <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />{t('adminUi.refresh', 'Refresh')}
        </Button>
      }
    >
      {state === 'loading' && (
        <p className="flex items-center gap-2 py-6 text-[14px] text-meta" role="status">
          <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />{t('adminUi.loading', 'Loading…')}
        </p>
      )}
      {state === 'error' && (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-[14px] text-red-900">
          {t('adminSettings.loadFailed', 'The switches could not be read. Check your connection and press Refresh. Nothing was changed.')}
        </p>
      )}
      {state === 'ready' && value && (
        <div className="space-y-6">
          {GROUPS.map(g => (
            <section key={g} aria-label={groupTitle(g, t)}>
              <h3 className="text-meta-caps mb-2">{groupTitle(g, t)}</h3>
              <ul className="divide-y divide-rule overflow-hidden rounded-xl border border-rule">
                {infos.filter(i => i.group === g).map(info => {
                  const raw = value[info.key];
                  const on = raw === true;
                  const odd = raw !== undefined && typeof raw !== 'boolean';
                  return (
                    <li key={info.key} className="flex items-start gap-3 bg-white px-3 py-3 sm:px-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-[15px] font-semibold leading-5 text-navy">{info.title}</p>
                          <AdminStatusPill tone={on ? 'success' : 'neutral'}>{on ? t('adminSettings.on', 'On') : t('adminSettings.off', 'Off')}</AdminStatusPill>
                          {info.serverOnly && <AdminStatusPill tone="info">{t('adminSettings.serverOnly', 'E-mails / server')}</AdminStatusPill>}
                          {(info.runbook) && <AdminStatusPill tone="warning" icon={AlertTriangle}>{t('adminSettings.runbookPill', 'Runbook')}</AdminStatusPill>}
                        </div>
                        <p className="mt-1 text-[14px] leading-5 text-meta">{info.what}</p>
                        {odd && (
                          <p className="mt-1 text-[13px] leading-5 text-amber-800">
                            {t('adminSettings.oddValue', 'Stored as {{value}}, which counts as off. Saving writes a proper on/off.', { value: JSON.stringify(raw) })}
                          </p>
                        )}
                        <p className="mt-1 font-mono text-[11px] leading-4 text-meta/80">{info.key}</p>
                      </div>
                      <Switch
                        checked={on}
                        onCheckedChange={next => { setError(null); setPending({ info, next, acknowledged: false }); }}
                        aria-label={info.title}
                        className="mt-0.5 shrink-0"
                      />
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
          {others.length > 0 && (
            <section>
              <h3 className="text-meta-caps mb-2">{t('adminSettings.others', 'Other switches stored (set by the developers)')}</h3>
              <ul className="space-y-1 text-[13px] leading-5 text-meta">
                {others.map(([k, v]) => <li key={k} className="font-mono">{k}: {JSON.stringify(v)}</li>)}
              </ul>
            </section>
          )}
          {updatedAt && (
            <p className="text-[12px] text-meta">
              {t('adminSettings.lastChange', 'Last change: {{date}}', { date: new Date(updatedAt).toLocaleString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }) })}
            </p>
          )}
        </div>
      )}

      <Dialog open={!!pending} onOpenChange={o => { if (!o && !saving) { setPending(null); setError(null); } }}>
        <DialogContent className="max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-lg overflow-y-auto rounded-card p-4 sm:p-6">
          {shownPending && (
            <>
              <DialogHeader className="pr-8 text-left">
                <DialogTitle className="text-[19px] leading-7 text-navy">
                  {shownPending.next
                    ? t('adminSettings.confirm.onTitle', 'Turn on "{{title}}"?', { title: shownPending.info.title })
                    : t('adminSettings.confirm.offTitle', 'Turn off "{{title}}"?', { title: shownPending.info.title })}
                </DialogTitle>
                <DialogDescription className="text-[14px] leading-5 text-meta">
                  <span className="block font-semibold text-navy">{t('adminSettings.confirm.changes', 'What changes')}</span>
                  {shownPending.next ? shownPending.info.on : shownPending.info.off}
                </DialogDescription>
              </DialogHeader>
              {shownPending.next && shownPending.info.warning && (
                <p className={cn('rounded-xl border px-3 py-2.5 text-[14px] leading-5', shownPending.info.runbook ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-rule bg-page text-navy')}>
                  <AlertTriangle className="mr-1.5 inline h-4 w-4 align-[-2px]" aria-hidden="true" />
                  {shownPending.info.warning}
                </p>
              )}
              {shownPending.next && shownPending.info.runbook && (
                <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border border-rule bg-white px-3 py-2.5 text-[14px] leading-5 text-navy">
                  <Checkbox className="mt-0.5" checked={shownPending.acknowledged} onCheckedChange={v => setPending(p => (p ? { ...p, acknowledged: v === true } : p))} />
                  <span>{t('adminSettings.confirm.ack', 'I have followed the runbook ({{runbook}}).', { runbook: shownPending.info.runbook })}</span>
                </label>
              )}
              {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-[14px] leading-5 text-red-900">{error}</p>}
              <DialogFooter className="gap-2 sm:gap-2">
                <Button type="button" variant="outline" size="sm" className={cn(ADMIN_BTN, 'h-11')} onClick={() => { setPending(null); setError(null); }} disabled={saving}>
                  {t('adminReview.cancel', 'Cancel')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={shownPending.next ? 'default' : 'outline'}
                  className={cn(shownPending.next ? ADMIN_BTN_PRIMARY : ADMIN_BTN_DANGER, 'h-11')}
                  onClick={() => save()}
                  disabled={saving || (!!shownPending.info.runbook && shownPending.next && !shownPending.acknowledged)}
                >
                  {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Power className="mr-1.5 h-4 w-4" aria-hidden="true" />}
                  {shownPending.next ? t('adminSettings.confirm.on', 'Turn on') : t('adminSettings.confirm.off', 'Turn off')}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </AdminPanel>
  );
}
