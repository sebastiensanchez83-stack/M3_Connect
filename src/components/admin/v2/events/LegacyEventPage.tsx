import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CalendarDays, ExternalLink, MailCheck, PenLine, Users } from 'lucide-react';
import { eventPath } from '@/lib/seoMeta';
import {
  AdminDetailHeader, AdminEmpty, AdminLoading, AdminPanel, AdminStatusPill, statusTone,
} from '../../AdminUI';
import {
  Breakdown, EVENT_TABS, EventBadges, EventTabs, Facts, Figures, GoPanel, GoRow, TAB_LABEL, TabBody, TabNote, useEventTab, type EventTab,
} from './EventPageKit';
import { fmtDay, money, perWeek, shortDate, shortTime, tally, topEntries, weekLabel, words, type EventSummary } from './eventsApi';
import { LEGACY_PAYMENT_WORD, loadLegacyFacts, type LegacyFacts } from './systemFacts';

/**
 * The page of an OLD-system event (an events row with no guest list and no fair behind it:
 * the webinars made before the new editor), /admin/events/<id>. Its registrations live in
 * event_registrations and are approved or refused in the old event editor
 * (/admin/events/<id>/edit), which also changes the event itself. This page shows the figures
 * with the same tabs as every event and sends there (VIEW everywhere, ACT in one place).
 * Tabs that can never apply to it are hidden: the old system has no door check-in, no
 * invitations and, for a webinar, no payment.
 */

export function LegacyEventPage({ id }: { id: string }) {
  const { t } = useTranslation();
  const [facts, setFacts] = useState<LegacyFacts | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setFacts(undefined);
    loadLegacyFacts(id)
      .then(f => { if (alive) setFacts(f); })
      .catch((e: unknown) => { if (alive) { setFacts(null); setError(e instanceof Error ? e.message : 'Could not load.'); } });
    return () => { alive = false; };
  }, [id]);

  const cat = facts?.catalogue ?? null;
  const onsite = cat?.event_type === 'on_site';
  const regs = facts?.regs ?? null;
  const paying = onsite || !!regs?.some(r => (r.amount_due_cents ?? 0) > 0);
  const available = useMemo<EventTab[]>(
    () => EVENT_TABS.filter(k => k !== 'checkin' && k !== 'invitations' && (k !== 'payments' || paying)),
    [paying],
  );
  const [tab, setTab] = useEventTab(available);

  if (facts === undefined) return <AdminLoading />;
  if (!facts || !cat) {
    return (
      <div className="mx-auto max-w-5xl">
        <AdminDetailHeader back={{ to: '/admin/events', label: t('adminEventsV2.back', 'All events') }} title={t('adminEventsV2.notFound', 'Event not found')} />
        <div className="rounded-card border border-rule bg-white">
          <AdminEmpty icon={CalendarDays} title={error ? t('adminEventsV2.loadError', 'This event could not be loaded') : t('adminEventsV2.none', 'There is no event with this address')} body={error ?? undefined} />
        </div>
      </div>
    );
  }

  const editor = `/admin/events/${cat.id}/edit`;
  const summary: Pick<EventSummary, 'kind' | 'published' | 'test' | 'start' | 'end' | 'system' | 'allDay' | 'invitationOnly'> = {
    kind: onsite ? 'onsite' : 'webinar',
    published: cat.published !== false,
    test: false,
    start: cat.date_time,
    end: cat.end_date_time,
    allDay: !!cat.is_full_day,
    system: 'legacy',
    invitationOnly: !!cat.invitation_only,
  };
  const date = shortDate(summary);
  const time = shortTime(summary);
  const when = date ? (time ? `${date}, ${time} (Monaco time)` : date) : t('adminEventsV2.noDate', 'Date to be set');
  const place = onsite ? cat.location : t('adminEventsV2.online', 'Online');
  const publicHref = eventPath({ id: cat.id, slug: cat.slug ?? null });
  const list = regs ?? [];
  const byPay = tally(list.map(r => r.payment_status ?? 'free'));
  const waiting = byPay.pending_approval ?? 0;
  const inCount = list.length - waiting - (byPay.rejected ?? 0);
  const due = list.filter(r => r.payment_status === 'pending_payment').reduce((s, r) => s + (r.amount_due_cents ?? 0), 0);
  const paid = list.filter(r => r.payment_status === 'paid').reduce((s, r) => s + (r.amount_due_cents ?? 0), 0);
  const reminders = list.filter(r => !!r.reminder_sent_at);
  const v = (x: number) => (regs ? x : null);

  const editorRow = (title: string, meta: string) => (
    <GoRow to={editor} icon={PenLine} title={title} meta={meta} cue={t('adminEventsV2.legacy.openEditor', 'Open the event editor')} />
  );
  const failedNote = facts.failed.length > 0 && (
    <TabNote tone="warning">
      {t('adminEventsV2.partial', 'Some figures could not be read ({{what}}). They show a dash. Reload the page to try again.', { what: facts.failed.join(', ') })}
    </TabNote>
  );
  const tabs = available.map(k => ({
    key: k,
    label: t(`adminEventsV2.tab.${k}`, TAB_LABEL[k]),
    count: k === 'registrations' && regs ? regs.length : null,
  }));

  return (
    <div className="mx-auto max-w-5xl">
      <AdminDetailHeader
        back={{ to: '/admin/events', label: t('adminEventsV2.back', 'All events') }}
        title={cat.title || t('adminEventsV2.untitled', 'Untitled event')}
        badges={<EventBadges e={summary} />}
        subtitle={[when, place].filter(Boolean).join(' · ')}
        actions={(
          <>
            <a href={publicHref} target="_blank" rel="noopener noreferrer" className="inline-flex h-10 items-center gap-1.5 rounded-pill border border-navy/25 bg-white px-4 text-[14px] font-semibold text-navy hover:border-navy hover:bg-chip focus:outline-none focus-visible:shadow-focus">
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
              {t('adminEventsV2.viewPublic', 'View the public page')}
            </a>
            <Link to={editor} className="inline-flex h-10 items-center gap-1.5 rounded-pill bg-gold px-4 text-[14px] font-semibold text-navy hover:bg-gold-hover focus:outline-none focus-visible:shadow-focus">
              <PenLine className="h-4 w-4" aria-hidden="true" />
              {t('adminEventsV2.legacy.edit', 'Change this event')}
            </Link>
          </>
        )}
      />

      <EventTabs tabs={tabs} value={tab} onChange={setTab} label={t('adminEventsV2.tabsLabel', 'Parts of the event')} />

      {tab === 'overview' && (
        <TabBody>
          {failedNote}
          <TabNote>{t('adminEventsV2.legacy.note', 'This event was made with the old event editor. It is changed there, and its registrations are approved or refused there too.')}</TabNote>
          <Figures items={[
            { label: t('adminEventsV2.fig.registered', 'Registered'), value: v(inCount), onClick: () => setTab('registrations') },
            { label: t('adminEventsV2.fig.waiting', 'Waiting for a decision'), value: v(waiting), onClick: () => setTab('registrations'), tone: waiting ? 'attention' : 'default' },
            { label: t('adminEventsV2.fig.refused', 'Refused'), value: v(byPay.rejected ?? 0) },
            { label: t('adminEventsV2.fig.places', 'Places'), value: cat.max_attendance ?? '—' },
          ]} />
          <AdminPanel title={t('adminEventsV2.atAGlance', 'At a glance')}>
            <Facts items={[
              { label: t('adminEventsV2.when', 'When'), value: when },
              { label: t('adminEventsV2.where', 'Where'), value: place },
              { label: t('adminEventsV2.legacy.access', 'Who can see it'), value: cat.access_level === 'public' ? t('adminEventsV2.legacy.everyone', 'Everyone') : cat.access_level ? words(cat.access_level) : null },
              { label: t('adminEventsV2.legacy.language', 'Language'), value: cat.language },
              { label: t('adminEventsV2.legacy.replay', 'Replay'), value: cat.replay_url ? t('adminEventsV2.legacy.replayYes', 'A replay link is saved') : t('adminEventsV2.legacy.replayNo', 'No replay link') },
              { label: t('adminEventsV2.legacy.fees', 'Price'), value: cat.fees },
            ]} />
          </AdminPanel>
          <GoPanel title={t('adminEventsV2.whereDone', 'Where things are done')}>
            {editorRow(t('adminEventsV2.legacy.editTitle', 'The event and its registrations'), t('adminEventsV2.legacy.editMeta', 'Title, date, text, speakers, links; approve or refuse a registration'))}
            <GoRow href={publicHref} icon={ExternalLink} title={t('adminEventsV2.seePublic', 'See it as visitors do')} meta={publicHref} cue={t('adminEventsV2.viewPublic', 'View the public page')} />
          </GoPanel>
        </TabBody>
      )}

      {tab === 'registrations' && (
        <TabBody>
          {failedNote}
          {waiting > 0 && (
            <GoPanel title={t('adminEventsV2.legacy.toDecide', '{{n}} waiting for a decision', { n: waiting })}>
              {editorRow(t('adminEventsV2.legacy.decideTitle', 'Approve or refuse'), t('adminEventsV2.legacy.decideMeta', 'In the old event editor, at the bottom of the page'))}
            </GoPanel>
          )}
          <AdminPanel title={t('adminEventsV2.legacy.people', 'People registered')} icon={Users} padded={false} description={t('adminEventsV2.legacy.peopleDesc', 'Read only. Decisions are made in the event editor.')}>
            {list.length === 0 ? (
              <AdminEmpty icon={Users} title={regs === null ? t('adminEventsV2.legacy.unreadable', 'The registrations could not be read') : t('adminEventsV2.legacy.noRegs', 'No registration yet')} />
            ) : (
              <ul className="divide-y divide-rule">
                {list.map(r => (
                  <li key={r.id} className="flex flex-col gap-1.5 px-5 py-3.5 sm:flex-row sm:items-center sm:gap-3">
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] font-semibold leading-5 text-navy [overflow-wrap:anywhere]">{r.name}</span>
                      <span className="mt-0.5 block text-[13px] leading-[18px] text-meta [overflow-wrap:anywhere]">
                        {[r.email, r.company, t('adminEventsV2.legacy.on', 'registered {{d}}', { d: fmtDay(r.created_at) })].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-wrap items-center gap-1.5">
                      {(r.amount_due_cents ?? 0) > 0 && <span className="text-[13px] tabular-nums text-ink">{money(r.amount_due_cents ?? 0)}</span>}
                      <AdminStatusPill tone={r.payment_status === 'pending_approval' ? 'warning' : statusTone(r.payment_status)}>
                        {LEGACY_PAYMENT_WORD[r.payment_status ?? 'free'] ?? words(r.payment_status)}
                      </AdminStatusPill>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </AdminPanel>
        </TabBody>
      )}

      {tab === 'emails' && (
        <TabBody>
          <Figures items={[
            { label: t('adminEventsV2.legacy.reminders', 'Reminders sent'), value: v(reminders.length) },
            { label: t('adminEventsV2.fig.lastMail', 'Last one sent'), value: regs ? fmtDay(reminders.map(r => r.reminder_sent_at as string).sort().pop()) : null },
          ]} />
          <TabNote>{t('adminEventsV2.legacy.mailsNote', 'For an old-system event, the e-mail recorded on each registration is the reminder before the event. Its text is not changed here.')}</TabNote>
          <GoPanel title={t('adminEventsV2.mailLogTitle', 'Every e-mail, person by person')}>
            <GoRow to="/admin/email-log" icon={MailCheck} title={t('adminEventsV2.mailLog', 'E-mail log')} meta={t('adminEventsV2.mailLogMeta', 'Who received what and when, for every event')} cue={t('adminEventsV2.openMailLog', 'Open the e-mail log')} />
          </GoPanel>
        </TabBody>
      )}

      {tab === 'payments' && (
        <TabBody>
          <Figures items={[
            { label: t('adminEventsV2.fig.paid', 'Paid'), value: regs ? money(paid) : null },
            { label: t('adminEventsV2.fig.due', 'Payment due'), value: regs ? money(due) : null, tone: due ? 'attention' : 'default' },
            { label: t('adminEventsV2.fig.freeRegs', 'Free registrations'), value: v(byPay.free ?? 0) },
          ]} />
          <Breakdown title={t('adminEventsV2.byStatus', 'By status')} rows={topEntries(byPay, 10, k => LEGACY_PAYMENT_WORD[k] ?? words(k))} empty={t('adminEventsV2.legacy.noRegs', 'No registration yet')} />
          <GoPanel title={t('adminEventsV2.legacy.payHere', 'The amount is set when a registration is approved, in the event editor')}>
            {editorRow(t('adminEventsV2.legacy.decideTitle', 'Approve or refuse'), t('adminEventsV2.legacy.payMeta', 'Prices per sponsor level are also set there'))}
          </GoPanel>
        </TabBody>
      )}

      {tab === 'modules' && (
        <TabBody>
          <TabNote>{t('adminEventsV2.legacy.modules', 'Events of the old system have no extra modules. A new event made with the new event editor gets registration questions, reminders and, for on-site events, the door check-in.')}</TabNote>
          <GoPanel title={t('adminEventsV2.legacy.newOne', 'Next time')}>
            <GoRow to="/admin/events/new" icon={CalendarDays} title={t('adminEventsV2.legacy.newTitle', 'Create an event with the new editor')} meta={t('adminEventsV2.legacy.newMeta', 'A webinar or an on-site event')} cue={t('adminEventsV2.createEvent', 'Create an event')} />
          </GoPanel>
        </TabBody>
      )}

      {tab === 'statistics' && (
        <TabBody>
          <div className="grid gap-5 lg:grid-cols-2">
            <Breakdown title={t('adminEventsV2.byStatus', 'Registrations by status')} rows={topEntries(byPay, 10, k => LEGACY_PAYMENT_WORD[k] ?? words(k))} empty={t('adminEventsV2.legacy.noRegs', 'No registration yet')} />
            <Breakdown title={t('adminEventsV2.byType', 'By kind of registration')} rows={topEntries(tally(list.map(r => r.registration_type ?? 'standard')), 8, words)} empty={t('adminEventsV2.legacy.noRegs', 'No registration yet')} />
            <Breakdown title={t('adminEventsV2.perWeek', 'Registrations per week')} rows={perWeek(list.map(r => r.created_at)).map(w => ({ label: weekLabel(w.week), n: w.n }))} empty={t('adminEventsV2.legacy.noRegs', 'No registration yet')} />
          </div>
        </TabBody>
      )}

      {tab === 'settings' && (
        <TabBody>
          <GoPanel title={t('adminEventsV2.legacy.settingsTitle', 'This event is set up in the old event editor')} description={t('adminEventsV2.legacy.settingsDesc', 'Title, date, description, speakers, the online link, the replay, the photo, the public address and whether it is published.')}>
            {editorRow(t('adminEventsV2.legacy.editor', 'The event editor'), t('adminEventsV2.legacy.editorMeta', 'Save there; this page shows the result'))}
          </GoPanel>
        </TabBody>
      )}
    </div>
  );
}
