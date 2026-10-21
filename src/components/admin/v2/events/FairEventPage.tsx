import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Activity, BookOpen, Building2, CalendarDays, ClipboardList, ExternalLink, KeyRound, Mail, MailCheck, Megaphone, MessageSquare, PenLine,
  QrCode, Scale, Truck, Upload, UsersRound, Wallet, type LucideIcon,
} from 'lucide-react';
import { eventPath } from '@/lib/seoMeta';
import { AdminDetailHeader, AdminEmpty, AdminLoading, AdminPanel } from '../../AdminUI';
import {
  Breakdown, EVENT_TABS, EventBadges, EventTabs, Facts, Figures, GoPanel, GoRow, TAB_LABEL, TabBody, TabNote, useEventTab, type EventTab,
} from './EventPageKit';
import { fmtDay, money, perWeek, shortDate, tally, topEntries, weekLabel, words, type EventSummary } from './eventsApi';
import { FAIR_CONSOLE_BASE, fairHasConsole } from './eventSystems';
import { FAIR_PAYMENT_WORD, FAIR_STATUS_WORD, FAIR_WAITING, RSVP_WORD, loadFairFacts, type FairFacts } from './systemFacts';

/**
 * The page of a FAIR (sm_event; today the Smart Marina Rendezvous), /admin/events/fair/<slug>.
 * The fair is run from its own console (/admin/sm26/*, frozen): this page SHOWS its figures with
 * the same tabs as every other event and sends to the console screen where each thing is done
 * (VIEW everywhere, ACT in one place). Nothing here writes.
 */

const MODULES: { path: string; title: string; body: string; icon: LucideIcon }[] = [
  { path: '/agenda', title: 'Programme', body: 'Sessions, speakers and rooms; publishing the programme.', icon: CalendarDays },
  { path: '/evaluation', title: 'Evaluation & Awards', body: 'The jury, the scores, the public vote and the awards.', icon: Scale },
  { path: '/architecture', title: 'Architecture', body: 'The architecture competition entries and their reviewers.', icon: Building2 },
  { path: '/ecat', title: 'E-catalogue', body: 'Exhibitor pages of the online catalogue and their review.', icon: BookOpen },
  { path: '/mediakits', title: 'Media kits', body: 'The media kits made for participants.', icon: Megaphone },
  { path: '/logistics', title: 'Logistics', body: 'Stands, deliveries and on-site needs.', icon: Truck },
  { path: '/networking', title: 'Networking', body: 'Meetings between participants and the exhibitor table codes.', icon: UsersRound },
  { path: '/feedback', title: 'Feedback', body: 'The survey after the fair and its answers.', icon: MessageSquare },
  { path: '/import', title: 'Import', body: 'Bringing in registrations from a file.', icon: Upload },
];

export function FairEventPage() {
  const { t } = useTranslation();
  const { slug = '' } = useParams<{ slug: string }>();
  const [facts, setFacts] = useState<FairFacts | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useEventTab(EVENT_TABS);

  useEffect(() => {
    let alive = true;
    setFacts(undefined);
    setError(null);
    loadFairFacts(slug)
      .then(f => { if (alive) setFacts(f); })
      .catch((e: unknown) => { if (alive) { setFacts(null); setError(e instanceof Error ? e.message : 'Could not load.'); } });
    return () => { alive = false; };
  }, [slug]);

  const fig = useMemo(() => {
    if (!facts) return null;
    const regs = facts.regs ?? [];
    const byStatus = tally(regs.map(r => r.status));
    const checkins = facts.checkins ?? [];
    const peopleIn = new Set(checkins.map(c => c.attendee_id ?? `r:${c.registration_id}`)).size;
    const pays = facts.payments ?? [];
    const sumOf = (status: string) => pays.filter(p => p.status === status).reduce((s, p) => s + (p.amount_cents ?? 0), 0);
    return {
      byStatus,
      confirmed: byStatus.confirmed ?? 0,
      waiting: FAIR_WAITING.reduce((n, k) => n + (byStatus[k] ?? 0), 0),
      total: regs.length,
      attending: (facts.attendees ?? []).filter(a => a.attending !== false).length,
      peopleIn,
      scans: checkins.length,
      byWindow: tally(checkins.map(c => c.window_key ?? '')),
      byPayment: tally(pays.map(p => p.status)),
      paidSum: sumOf('paid'),
      invoicedSum: sumOf('invoiced'),
      currency: pays.find(p => p.currency)?.currency ?? 'EUR',
      byMail: tally((facts.mails ?? []).map(m => m.kind)),
      lastMail: facts.mails?.[0]?.sent_at ?? null,
      byRole: tally((facts.roles ?? []).filter(r => r.status !== 'declined').map(r => r.role)),
      byCountry: tally(regs.map(r => (r.country ?? '').trim() || 'Not given')),
      weeks: perWeek(regs.map(r => r.created_at)),
      invTotal: (facts.invitations ?? []).length,
      byRsvp: tally((facts.invitations ?? []).map(i => i.rsvp_status ?? 'awaiting')),
      byInvStatus: tally((facts.invitations ?? []).map(i => i.status ?? 'draft')),
    };
  }, [facts]);

  if (facts === undefined) return <AdminLoading />;
  if (!facts || !fig) {
    return (
      <div className="mx-auto max-w-5xl">
        <AdminDetailHeader back={{ to: '/admin/events', label: t('adminEventsV2.back', 'All events') }} title={t('adminEventsV2.fair.notFound', 'Event not found')} />
        <div className="rounded-card border border-rule bg-white">
          <AdminEmpty icon={CalendarDays} title={error ? t('adminEventsV2.loadError', 'This event could not be loaded') : t('adminEventsV2.fair.none', 'There is no fair with this address')} body={error ?? undefined} />
        </div>
      </div>
    );
  }

  const ev = facts.event;
  const cat = facts.catalogue;
  const hasConsole = fairHasConsole(ev.slug);
  const at = (p: string) => (hasConsole ? `${FAIR_CONSOLE_BASE}${p}` : null);
  const title = cat?.title || ev.name || ev.slug;
  const summary: Pick<EventSummary, 'kind' | 'published' | 'test' | 'start' | 'end' | 'system'> = {
    kind: 'onsite',
    published: cat ? cat.published !== false : ev.status ? ev.status !== 'draft' : null,
    test: false,
    start: cat?.date_time ?? (ev.start_date ? `${ev.start_date}T08:00:00Z` : null),
    end: cat?.end_date_time ?? (ev.end_date ? `${ev.end_date}T20:00:00Z` : null),
    system: 'fair',
  };
  const when = shortDate(summary) ?? t('adminEventsV2.noDate', 'Date to be set');
  const place = cat?.location || ev.venue || null;
  const publicHref = cat ? eventPath({ id: cat.id, slug: cat.slug ?? null }) : null;
  const editPublic = cat ? `/admin/events/${cat.id}/edit` : null;
  const settings = ev.settings || {};
  const n = (v: number) => v;
  const dash = (list: unknown[] | null, v: number) => (list === null ? null : n(v));

  const noConsole = !hasConsole && (
    <TabNote>
      {t('adminEventsV2.fair.noConsole', 'This fair has no console screens yet: the console serves one fair at a time. Its figures are shown here; its tools come with the event modules planned after the World Yachting Summit.')}
    </TabNote>
  );
  const failedNote = facts.failed.length > 0 && (
    <TabNote tone="warning">
      {t('adminEventsV2.partial', 'Some figures could not be read ({{what}}). They show a dash. Reload the page to try again.', { what: facts.failed.join(', ') })}
    </TabNote>
  );

  const tabs = EVENT_TABS.map(k => ({
    key: k,
    label: t(`adminEventsV2.tab.${k}`, TAB_LABEL[k]),
    count: k === 'registrations' ? (facts.regs ? fig.total : null) : null,
  }));

  return (
    <div className="mx-auto max-w-5xl">
      <AdminDetailHeader
        back={{ to: '/admin/events', label: t('adminEventsV2.back', 'All events') }}
        title={title}
        badges={<EventBadges e={summary} />}
        subtitle={[when, place].filter(Boolean).join(' · ')}
        actions={publicHref ? (
          <a href={publicHref} target="_blank" rel="noopener noreferrer" className="inline-flex h-10 items-center gap-1.5 rounded-pill border border-navy/25 bg-white px-4 text-[14px] font-semibold text-navy hover:border-navy hover:bg-chip focus:outline-none focus-visible:shadow-focus">
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
            {t('adminEventsV2.viewPublic', 'View the public page')}
          </a>
        ) : undefined}
      />

      <EventTabs tabs={tabs} value={tab} onChange={setTab} label={t('adminEventsV2.tabsLabel', 'Parts of the event')} />

      {tab === 'overview' && (
        <TabBody>
          {failedNote}
          {noConsole}
          <Figures items={[
            { label: t('adminEventsV2.fig.confirmed', 'Confirmed registrations'), value: dash(facts.regs, fig.confirmed), onClick: () => setTab('registrations') },
            { label: t('adminEventsV2.fig.waiting', 'Waiting for a decision'), value: dash(facts.regs, fig.waiting), onClick: () => setTab('registrations'), tone: fig.waiting ? 'attention' : 'default' },
            { label: t('adminEventsV2.fig.attending', 'People attending'), value: dash(facts.attendees, fig.attending), onClick: () => setTab('checkin') },
            { label: t('adminEventsV2.fig.checkedIn', 'People checked in at the door'), value: dash(facts.checkins, fig.peopleIn), onClick: () => setTab('checkin') },
          ]} />
          <AdminPanel title={t('adminEventsV2.atAGlance', 'At a glance')}>
            <Facts items={[
              { label: t('adminEventsV2.when', 'When'), value: when },
              { label: t('adminEventsV2.where', 'Where'), value: place },
              { label: t('adminEventsV2.fair.edition', 'Edition'), value: typeof settings.edition_label === 'string' ? settings.edition_label : null },
              { label: t('adminEventsV2.fair.regOpen', 'Registration'), value: settings.registrations_open === false ? t('adminEventsV2.closed', 'Closed') : settings.registrations_open === true ? t('adminEventsV2.open', 'Open') : null },
            ]} />
          </AdminPanel>
          <GoPanel title={t('adminEventsV2.whereDone', 'Where things are done')} description={t('adminEventsV2.fair.whereDoneDesc', 'This fair is run from its own console. Each button opens the screen where it is done.')}>
            {at('/health') && <GoRow to={at('/health')!} icon={Activity} title={t('adminEventsV2.fair.consoleOverview', 'The fair at a glance')} meta={t('adminEventsV2.fair.consoleOverviewMeta', 'What is missing, deadlines, partners')} cue={t('adminEventsV2.fair.openOverview', 'Open the overview')} />}
            {at('') && <GoRow to={at('')!} icon={ClipboardList} title={t('adminEventsV2.fair.regsTitle', 'Registrations and payments')} meta={t('adminEventsV2.fair.regsMeta', 'Accept, refuse, ask for information, record payments')} cue={t('adminEventsV2.fair.openRegs', 'Open the registrations')} />}
            {at('/checkin') && <GoRow to={at('/checkin')!} icon={QrCode} title={t('adminEventsV2.fair.doorTitle', 'The door')} meta={t('adminEventsV2.fair.doorMeta', 'Scan badges at the entrance')} cue={t('adminEventsV2.fair.openDoor', 'Open the door check-in')} />}
            {editPublic && <GoRow to={editPublic} icon={PenLine} title={t('adminEventsV2.publicPage', 'The public event page')} meta={t('adminEventsV2.publicPageMeta', 'Title, dates, text and photo')} cue={t('adminEventsV2.changePublic', 'Change the public page')} />}
            {publicHref && <GoRow href={publicHref} icon={ExternalLink} title={t('adminEventsV2.seePublic', 'See it as visitors do')} meta={publicHref} cue={t('adminEventsV2.viewPublic', 'View the public page')} />}
          </GoPanel>
        </TabBody>
      )}

      {tab === 'registrations' && (
        <TabBody>
          {failedNote}
          <Figures items={[
            { label: t('adminEventsV2.fig.confirmed', 'Confirmed registrations'), value: dash(facts.regs, fig.confirmed) },
            { label: t('adminEventsV2.fig.waiting', 'Waiting for a decision'), value: dash(facts.regs, fig.waiting), tone: fig.waiting ? 'attention' : 'default' },
            { label: t('adminEventsV2.fig.cancelled', 'Cancelled or not accepted'), value: dash(facts.regs, (fig.byStatus.cancelled ?? 0) + (fig.byStatus.declined ?? 0)) },
            { label: t('adminEventsV2.fig.total', 'Registrations in total'), value: dash(facts.regs, fig.total) },
          ]} />
          {noConsole || (
            <GoPanel title={t('adminEventsV2.fair.regsHere', 'Registrations are handled in the fair console')}>
              <GoRow to={at('')!} icon={ClipboardList} title={t('adminEventsV2.fair.regsTitle', 'Registrations and payments')} meta={t('adminEventsV2.fair.regsMeta', 'Accept, refuse, ask for information, record payments')} cue={t('adminEventsV2.fair.openRegs', 'Open the registrations')} />
            </GoPanel>
          )}
          <Breakdown title={t('adminEventsV2.byStatus', 'By status')} rows={topEntries(fig.byStatus, 10, k => FAIR_STATUS_WORD[k] ?? words(k))} />
        </TabBody>
      )}

      {tab === 'checkin' && (
        <TabBody>
          {failedNote}
          <Figures items={[
            { label: t('adminEventsV2.fig.attending', 'People attending'), value: dash(facts.attendees, fig.attending) },
            { label: t('adminEventsV2.fig.checkedIn', 'People checked in at the door'), value: dash(facts.checkins, fig.peopleIn) },
            { label: t('adminEventsV2.fig.scans', 'Badge scans'), value: dash(facts.checkins, fig.scans) },
            { label: t('adminEventsV2.fig.windows', 'Check-in times'), value: dash(facts.windows, (facts.windows ?? []).length) },
          ]} />
          {noConsole || (
            <GoPanel title={t('adminEventsV2.fair.doorHere', 'The door is handled in the fair console')}>
              <GoRow to={at('/checkin')!} icon={QrCode} title={t('adminEventsV2.fair.doorTitle', 'The door')} meta={t('adminEventsV2.fair.doorMeta', 'Scan badges at the entrance')} cue={t('adminEventsV2.fair.openDoor', 'Open the door check-in')} />
            </GoPanel>
          )}
          <Breakdown
            title={t('adminEventsV2.fair.byWindow', 'Scans per check-in time')}
            rows={topEntries(fig.byWindow, 12, k => (facts.windows ?? []).find(w => w.key === k)?.label || words(k))}
            empty={t('adminEventsV2.fair.noScans', 'Nobody has been scanned yet.')}
          />
        </TabBody>
      )}

      {tab === 'invitations' && (
        <TabBody>
          {failedNote}
          <Figures items={[
            { label: t('adminEventsV2.fig.letters', 'Invitation letters'), value: dash(facts.invitations, fig.invTotal) },
            { label: t('adminEventsV2.fig.accepted', 'Accepted'), value: dash(facts.invitations, fig.byRsvp.accepted ?? 0) },
            { label: t('adminEventsV2.fig.declined', 'Declined'), value: dash(facts.invitations, fig.byRsvp.declined ?? 0) },
            { label: t('adminEventsV2.fig.noReply', 'No answer yet'), value: dash(facts.invitations, (fig.byRsvp.awaiting ?? 0) + (fig.byRsvp.no_reply ?? 0) + (fig.byRsvp.tentative ?? 0)) },
          ]} />
          {noConsole || (
            <GoPanel title={t('adminEventsV2.fair.invHere', 'Invitations are written and sent in the fair console')}>
              <GoRow to={at('/invitations')!} icon={Mail} title={t('adminEventsV2.fair.invTitle', 'Invitation letters')} meta={t('adminEventsV2.fair.invMeta', 'Write, send and follow the answers')} cue={t('adminEventsV2.fair.openInv', 'Open the invitations')} />
            </GoPanel>
          )}
          <Breakdown title={t('adminEventsV2.fair.byRsvp', 'Answers')} rows={topEntries(fig.byRsvp, 8, k => RSVP_WORD[k] ?? words(k))} empty={t('adminEventsV2.fair.noInv', 'No invitation letter yet.')} />
        </TabBody>
      )}

      {tab === 'emails' && (
        <TabBody>
          {failedNote}
          <Figures items={[
            { label: t('adminEventsV2.fig.mails', 'E-mails sent'), value: dash(facts.mails, (facts.mails ?? []).length) },
            { label: t('adminEventsV2.fig.mailKinds', 'Kinds of e-mail'), value: dash(facts.mails, Object.keys(fig.byMail).length) },
            { label: t('adminEventsV2.fig.lastMail', 'Last one sent'), value: facts.mails === null ? null : fmtDay(fig.lastMail) },
          ]} />
          <TabNote>{t('adminEventsV2.fair.mailsNote', 'These e-mails are sent by the fair console (confirmations, QR codes, reminders, invoices). Their texts are not changed here.')}</TabNote>
          <GoPanel title={t('adminEventsV2.mailLogTitle', 'Every e-mail, person by person')}>
            <GoRow to="/admin/email-log" icon={MailCheck} title={t('adminEventsV2.mailLog', 'E-mail log')} meta={t('adminEventsV2.mailLogMeta', 'Who received what and when, for every event')} cue={t('adminEventsV2.openMailLog', 'Open the e-mail log')} />
          </GoPanel>
          <Breakdown title={t('adminEventsV2.byKind', 'By kind of e-mail')} rows={topEntries(fig.byMail, 20, words)} empty={t('adminEventsV2.noMails', 'No e-mail sent yet.')} />
        </TabBody>
      )}

      {tab === 'payments' && (
        <TabBody>
          {failedNote}
          <Figures items={[
            { label: t('adminEventsV2.fig.paid', 'Paid'), value: facts.payments === null ? null : money(fig.paidSum, fig.currency), hint: t('adminEventsV2.fig.nRegs', '{{n}} registrations', { n: fig.byPayment.paid ?? 0 }) },
            { label: t('adminEventsV2.fig.invoiced', 'Invoiced, not paid yet'), value: facts.payments === null ? null : money(fig.invoicedSum, fig.currency), hint: t('adminEventsV2.fig.nRegs', '{{n}} registrations', { n: fig.byPayment.invoiced ?? 0 }), tone: fig.byPayment.invoiced ? 'attention' : 'default' },
            { label: t('adminEventsV2.fig.free', 'Free of charge'), value: dash(facts.payments, fig.byPayment.waived ?? 0) },
            { label: t('adminEventsV2.fig.payRows', 'Payment records'), value: dash(facts.payments, (facts.payments ?? []).length) },
          ]} />
          {noConsole || (
            <GoPanel title={t('adminEventsV2.fair.payHere', 'Payments are recorded on each registration, in the fair console')}>
              <GoRow to={at('')!} icon={Wallet} title={t('adminEventsV2.fair.regsTitle', 'Registrations and payments')} meta={t('adminEventsV2.fair.payMeta', 'Open a registration to record a payment or add an invoice')} cue={t('adminEventsV2.fair.openRegs', 'Open the registrations')} />
            </GoPanel>
          )}
          <Breakdown title={t('adminEventsV2.byStatus', 'By status')} rows={topEntries(fig.byPayment, 10, k => FAIR_PAYMENT_WORD[k] ?? words(k))} empty={t('adminEventsV2.noPayments', 'No payment recorded.')} />
        </TabBody>
      )}

      {tab === 'modules' && (
        <TabBody>
          {noConsole || (
            <GoPanel title={t('adminEventsV2.fair.modulesTitle', 'The fair\'s tools')} description={t('adminEventsV2.fair.modulesDesc', 'Each one opens its screen in the fair console.')}>
              {MODULES.map(m => (
                <GoRow key={m.path} to={at(m.path)!} icon={m.icon} title={t(`adminEventsV2.fair.mod${m.path.replace('/', '.')}`, m.title)} meta={m.body} cue={t('adminEventsV2.open', 'Open')} />
              ))}
              <GoRow to={at('/health')!} icon={KeyRound} title={t('adminEventsV2.fair.partners', 'Partner access')} meta={t('adminEventsV2.fair.partnersMeta', 'Who may download dossiers or follow the startups (in the overview)')} cue={t('adminEventsV2.fair.openOverview', 'Open the overview')} />
            </GoPanel>
          )}
        </TabBody>
      )}

      {tab === 'statistics' && (
        <TabBody>
          {failedNote}
          <div className="grid gap-5 lg:grid-cols-2">
            <Breakdown title={t('adminEventsV2.byStatus', 'Registrations by status')} rows={topEntries(fig.byStatus, 10, k => FAIR_STATUS_WORD[k] ?? words(k))} />
            <Breakdown title={t('adminEventsV2.byRole', 'Participants by role')} rows={topEntries(fig.byRole, 10, words)} empty={t('adminEventsV2.noRoles', 'No role recorded.')} />
            <Breakdown title={t('adminEventsV2.byCountry', 'Registrations by country')} rows={topEntries(fig.byCountry, 10)} />
            <Breakdown title={t('adminEventsV2.perWeek', 'Registrations per week')} rows={fig.weeks.map(w => ({ label: weekLabel(w.week), n: w.n }))} />
          </div>
        </TabBody>
      )}

      {tab === 'settings' && (
        <TabBody>
          <GoPanel title={t('adminEventsV2.fair.settingsTitle', 'Where this fair is set up')} description={t('adminEventsV2.fair.settingsDesc', 'The fair keeps its settings in its console and its public page in the event editor.')}>
            {editPublic && <GoRow to={editPublic} icon={PenLine} title={t('adminEventsV2.publicPage', 'The public event page')} meta={t('adminEventsV2.publicPageMeta', 'Title, dates, text and photo')} cue={t('adminEventsV2.changePublic', 'Change the public page')} />}
            {at('/health') && <GoRow to={at('/health')!} icon={Activity} title={t('adminEventsV2.fair.deadlines', 'Deadlines and partner access')} meta={t('adminEventsV2.fair.deadlinesMeta', 'When participants can no longer change their details or their team')} cue={t('adminEventsV2.fair.openOverview', 'Open the overview')} />}
            {at('/agenda') && <GoRow to={at('/agenda')!} icon={CalendarDays} title={t('adminEventsV2.fair.programme', 'Publishing the programme')} meta={t('adminEventsV2.fair.programmeMeta', 'Show or hide the programme on the site')} cue={t('adminEventsV2.fair.openProgramme', 'Open the programme')} />}
          </GoPanel>
          {!editPublic && noConsole}
        </TabBody>
      )}
    </div>
  );
}
