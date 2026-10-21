import { useEffect, useMemo, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CalendarDays, ClipboardList, ExternalLink, Mail, MailCheck, PenLine, QrCode, Send, SlidersHorizontal } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { eventPath } from '@/lib/seoMeta';
import { AdminDetailHeader, AdminEmpty, AdminLoading, AdminPanel } from '../../AdminUI';
import {
  Breakdown, EVENT_TABS, EventBadges, EventTabs, Facts, Figures, GoPanel, GoRow, TAB_LABEL, TabBody, TabNote, useEventTab,
} from './EventPageKit';
import {
  fmtDay, GUEST_STATUS_WORD, sourceWord, guestFigures, loadCampaigns, loadGuestFacts, loadGuestListMails, shortDate, tally, topEntries, weekLabel, words,
  type CampaignFact, type EventSummary, type GuestFact, type MailFact,
} from './eventsApi';
import type { CatalogueLite } from './systemFacts';

/**
 * The page of a GUEST LIST (gl_event engine guest_list_v1; today the World Yachting Summit),
 * /admin/events/guest-list/<slug>. The guest list, its invitations and its door are frozen
 * screens (WYS on 27 Nov): this page SHOWS their figures with the same tabs as every event and
 * sends to the screen where each thing is done. It never writes, never reads a token, and
 * changes no link of the guest list (VIEW everywhere, ACT in one place).
 * A guest list made with the new event editor (engine core_v2) opens its own page instead.
 */

interface GlRow {
  id: string; slug: string; title: string | null; engine: string | null; kind: string | null; hidden: boolean | null;
  legacy_event_id: string | null; capacity: number | null; registration_mode: string | null; requests_open: boolean | null;
  access: string | null; closes_at: string | null; settings: Record<string, unknown> | null;
}

interface Loaded {
  gl: GlRow;
  catalogue: CatalogueLite | null;
  guests: GuestFact[] | null;
  mails: MailFact[] | null;
  campaigns: CampaignFact[] | null;
  failed: string[];
}

async function settle<T>(name: string, p: Promise<T>, failed: string[]): Promise<T | null> {
  try { return await p; } catch { failed.push(name); return null; }
}

async function loadGuestListPage(slug: string): Promise<Loaded | null> {
  const { data, error } = await supabase
    .from('gl_event')
    .select('id, slug, title, engine, kind, hidden, legacy_event_id, capacity, registration_mode, requests_open, access, closes_at, settings')
    .eq('slug', slug)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const gl = data as GlRow;
  const failed: string[] = [];
  const [catalogue, guests, mails, campaigns] = await Promise.all([
    gl.legacy_event_id
      ? settle('the public event page', (async () => {
        const r = await supabase.from('events').select('*').eq('id', gl.legacy_event_id as string).maybeSingle();
        if (r.error) throw new Error(r.error.message);
        return (r.data as CatalogueLite | null) ?? null;
      })(), failed)
      : Promise.resolve(null),
    settle('guests', loadGuestFacts(gl.id), failed),
    settle('e-mails', loadGuestListMails(gl.id), failed),
    settle('invitation campaigns', loadCampaigns(gl.id), failed),
  ]);
  return { gl, catalogue, guests, mails, campaigns, failed };
}

const RECIPIENT_WORD: Record<string, string> = {
  draft: 'Being prepared',
  ready: 'Ready to send',
  sent: 'Sent, no answer yet',
  accepted: 'Accepted',
  declined: 'Declined',
  no_answer: 'No answer',
};

export function GuestListEventPage() {
  const { t } = useTranslation();
  const { slug = '' } = useParams<{ slug: string }>();
  const [data, setData] = useState<Loaded | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useEventTab(EVENT_TABS);

  useEffect(() => {
    let alive = true;
    setData(undefined);
    setError(null);
    loadGuestListPage(slug)
      .then(d => { if (alive) setData(d); })
      .catch((e: unknown) => { if (alive) { setData(null); setError(e instanceof Error ? e.message : 'Could not load.'); } });
    return () => { alive = false; };
  }, [slug]);

  const fig = useMemo(() => (data?.guests ? guestFigures(data.guests) : null), [data]);

  if (data === undefined) return <AdminLoading />;
  if (!data) {
    return (
      <div className="mx-auto max-w-5xl">
        <AdminDetailHeader back={{ to: '/admin/events', label: t('adminEventsV2.back', 'All events') }} title={t('adminEventsV2.gl.notFound', 'Event not found')} />
        <div className="rounded-card border border-rule bg-white">
          <AdminEmpty icon={CalendarDays} title={error ? t('adminEventsV2.loadError', 'This event could not be loaded') : t('adminEventsV2.gl.none', 'There is no guest list with this address')} body={error ?? undefined} />
        </div>
      </div>
    );
  }
  // Made with the new event editor: everything is on its own page.
  if (data.gl.engine === 'core_v2') return <Navigate to={`/admin/events/${data.gl.legacy_event_id ?? data.gl.id}`} replace />;

  const { gl, catalogue: cat, guests, mails, campaigns } = data;
  const base = `/admin/guest-list/${encodeURIComponent(gl.slug)}`;
  const s = gl.settings || {};
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const title = cat?.title || gl.title || gl.slug;
  const summary: Pick<EventSummary, 'kind' | 'published' | 'test' | 'start' | 'end' | 'system'> = {
    kind: cat ? (cat.event_type === 'webinar' ? 'webinar' : 'onsite') : gl.kind === 'webinar' ? 'webinar' : 'onsite',
    published: cat ? cat.published !== false : null,
    test: gl.hidden === true,
    start: cat?.date_time ?? str(s.starts_at),
    end: cat?.end_date_time ?? str(s.ends_at),
    system: 'guest_list',
  };
  const when = shortDate(summary) ?? str(s.date_label) ?? t('adminEventsV2.noDate', 'Date to be set');
  const place = [str(s.venue), str(s.city)].filter(Boolean).join(', ') || cat?.location || null;
  const publicHref = cat ? eventPath({ id: cat.id, slug: cat.slug ?? null }) : null;
  const editPublic = cat ? `/admin/events/${cat.id}/edit` : null;
  const parts = Array.isArray(s.parts) ? (s.parts as { key?: string; label?: string; when?: string }[]) : [];
  const g = fig;
  const v = (x: number) => (g ? x : null);
  const sentMails = mails ?? [];
  const byMail = tally(sentMails.map(m => m.kind));
  const recipients = (campaigns ?? []).reduce<Record<string, number>>((acc, c) => {
    for (const [k, n] of Object.entries(c.recipients)) acc[k] = (acc[k] ?? 0) + n;
    return acc;
  }, {});
  const recipientTotal = Object.values(recipients).reduce((a, b) => a + b, 0);

  const failedNote = data.failed.length > 0 && (
    <TabNote tone="warning">
      {t('adminEventsV2.partial', 'Some figures could not be read ({{what}}). They show a dash. Reload the page to try again.', { what: data.failed.join(', ') })}
    </TabNote>
  );
  const guestListRow = (
    <GoRow to={base} icon={ClipboardList} title={t('adminEventsV2.gl.listTitle', 'The guest list')} meta={t('adminEventsV2.gl.listMeta', 'Accept or refuse requests, change a guest, export the list')} cue={t('adminEventsV2.gl.openList', 'Open the guest list')} />
  );
  const doorRow = (
    <GoRow to={`${base}/checkin`} icon={QrCode} title={t('adminEventsV2.gl.doorTitle', 'The door')} meta={t('adminEventsV2.gl.doorMeta', 'Scan the QR codes at the entrance, or find a guest by name')} cue={t('adminEventsV2.gl.openDoor', 'Open the door check-in')} />
  );
  const invRow = (
    <GoRow to={`${base}/invitations`} icon={Send} title={t('adminEventsV2.gl.invTitle', 'Personal invitations')} meta={t('adminEventsV2.gl.invMeta', 'Tickets and letters in PDF, sending and the answers')} cue={t('adminEventsV2.gl.openInv', 'Open the invitations')} />
  );

  const tabs = EVENT_TABS.map(k => ({
    key: k,
    label: t(`adminEventsV2.tab.${k}`, TAB_LABEL[k]),
    count: k === 'registrations' && g ? g.total : null,
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
          {gl.hidden && <TabNote>{t('adminEventsV2.gl.test', 'This is a test event of the set-up scripts. It is not shown to the public.')}</TabNote>}
          <Figures items={[
            { label: t('adminEventsV2.fig.in', 'Guests in (confirmed or approved)'), value: g && v(g.registered), onClick: () => setTab('registrations') },
            { label: t('adminEventsV2.fig.waiting', 'Waiting for a decision'), value: g && v(g.waiting), onClick: () => setTab('registrations'), tone: g?.waiting ? 'attention' : 'default' },
            { label: t('adminEventsV2.fig.invited', 'Invited, no answer yet'), value: g && v(g.invited), onClick: () => setTab('invitations') },
            { label: t('adminEventsV2.fig.places', 'Places'), value: gl.capacity ?? '—', hint: gl.capacity && g ? t('adminEventsV2.fig.placesHeld', '{{n}} held (guests in, or invited)', { n: g.registered + g.invited }) : undefined },
          ]} />
          <AdminPanel title={t('adminEventsV2.atAGlance', 'At a glance')}>
            <Facts items={[
              { label: t('adminEventsV2.when', 'When'), value: when },
              { label: t('adminEventsV2.where', 'Where'), value: place },
              { label: t('adminEventsV2.gl.how', 'How people come'), value: gl.registration_mode === 'invitation' ? t('adminEventsV2.gl.byInvitation', 'By invitation') : gl.registration_mode === 'review' ? t('adminEventsV2.gl.byRequest', 'They ask, M3 decides') : gl.registration_mode ? words(gl.registration_mode) : null },
              { label: t('adminEventsV2.gl.requests', 'Requests from the site'), value: gl.requests_open === false ? t('adminEventsV2.closed', 'Closed') : gl.requests_open ? t('adminEventsV2.open', 'Open') : null },
            ]} />
          </AdminPanel>
          <GoPanel title={t('adminEventsV2.whereDone', 'Where things are done')} description={t('adminEventsV2.gl.whereDoneDesc', 'This event runs on its guest list. Each button opens the screen where it is done.')}>
            {guestListRow}
            {invRow}
            {doorRow}
            {editPublic && <GoRow to={editPublic} icon={PenLine} title={t('adminEventsV2.publicPage', 'The public event page')} meta={t('adminEventsV2.publicPageMeta', 'Title, dates, text and photo')} cue={t('adminEventsV2.changePublic', 'Change the public page')} />}
          </GoPanel>
        </TabBody>
      )}

      {tab === 'registrations' && (
        <TabBody>
          {failedNote}
          <Figures items={[
            { label: t('adminEventsV2.fig.in', 'Guests in (confirmed or approved)'), value: g && v(g.registered) },
            { label: t('adminEventsV2.fig.waiting', 'Waiting for a decision'), value: g && v(g.waiting), tone: g?.waiting ? 'attention' : 'default' },
            { label: t('adminEventsV2.fig.declined', 'Declined'), value: g && v(g.declined) },
            { label: t('adminEventsV2.fig.total', 'Rows in the guest list'), value: g && v(g.total) },
          ]} />
          <GoPanel title={t('adminEventsV2.gl.regsHere', 'Requests are accepted and refused in the guest list')}>{guestListRow}</GoPanel>
          <Breakdown title={t('adminEventsV2.byStatus', 'By status')} rows={g ? topEntries(g.byStatus, 10, k => GUEST_STATUS_WORD[k] ?? words(k)) : []} empty={t('adminEventsV2.noGuests', 'Nobody in the guest list yet.')} />
        </TabBody>
      )}

      {tab === 'checkin' && (
        <TabBody>
          {failedNote}
          <Figures items={[
            { label: t('adminEventsV2.fig.expected', 'Guests expected'), value: g && v(g.registered) },
            { label: t('adminEventsV2.fig.checkedIn', 'People checked in at the door'), value: g && v(g.checkedIn) },
            { label: t('adminEventsV2.fig.notYet', 'Not arrived yet'), value: g && v(Math.max(0, g.registered - g.checkedInOfIn)) },
          ]} />
          <GoPanel title={t('adminEventsV2.gl.doorHere', 'The door works on any phone')}>{doorRow}</GoPanel>
        </TabBody>
      )}

      {tab === 'invitations' && (
        <TabBody>
          {failedNote}
          <Figures items={[
            { label: t('adminEventsV2.fig.campaigns', 'Invitation campaigns'), value: campaigns ? campaigns.filter(c => !c.archived).length : null },
            { label: t('adminEventsV2.fig.recipients', 'People on the invitation lists'), value: campaigns ? recipientTotal : null },
            { label: t('adminEventsV2.fig.accepted', 'Accepted'), value: campaigns ? recipients.accepted ?? 0 : null },
            { label: t('adminEventsV2.fig.invited', 'Invited, no answer yet'), value: g && v(g.invited) },
          ]} />
          <GoPanel title={t('adminEventsV2.gl.invHere', 'Invitations are prepared and sent in their own screen')}>{invRow}</GoPanel>
          <Breakdown title={t('adminEventsV2.gl.byRecipient', 'Invitations by stage')} rows={topEntries(recipients, 8, k => RECIPIENT_WORD[k] ?? words(k))} empty={t('adminEventsV2.gl.noRecipients', 'Nobody on an invitation list yet.')} />
        </TabBody>
      )}

      {tab === 'emails' && (
        <TabBody>
          {failedNote}
          <Figures items={[
            { label: t('adminEventsV2.fig.mails', 'E-mails sent'), value: mails ? sentMails.length : null },
            { label: t('adminEventsV2.fig.mailKinds', 'Kinds of e-mail'), value: mails ? Object.keys(byMail).length : null },
            { label: t('adminEventsV2.fig.lastMail', 'Last one sent'), value: mails ? fmtDay(sentMails[0]?.sent_at) : null },
          ]} />
          <TabNote>{t('adminEventsV2.gl.mailsNote', 'The guest list sends its own e-mails (acknowledgement, confirmation with the QR code, reminders). Their texts are not changed here.')}</TabNote>
          <GoPanel title={t('adminEventsV2.mailLogTitle', 'Every e-mail, person by person')}>
            <GoRow to="/admin/email-log" icon={MailCheck} title={t('adminEventsV2.mailLog', 'E-mail log')} meta={t('adminEventsV2.mailLogMeta', 'Who received what and when, for every event')} cue={t('adminEventsV2.openMailLog', 'Open the e-mail log')} />
          </GoPanel>
          <Breakdown title={t('adminEventsV2.byKind', 'By kind of e-mail')} rows={topEntries(byMail, 20, words)} empty={t('adminEventsV2.noMails', 'No e-mail sent yet.')} />
        </TabBody>
      )}

      {tab === 'payments' && (
        <TabBody>
          {failedNote}
          {g && Object.keys(g.byPayment).length > 0 ? (
            <>
              <Breakdown title={t('adminEventsV2.byStatus', 'By status')} rows={topEntries(g.byPayment, 10, words)} />
              <GoPanel title={t('adminEventsV2.gl.payHere', 'Payments are followed in the guest list')}>{guestListRow}</GoPanel>
            </>
          ) : (
            <TabNote>{t('adminEventsV2.gl.noPay', 'No guest of this event has anything to pay. If that changes, payments are followed in the guest list.')}</TabNote>
          )}
        </TabBody>
      )}

      {tab === 'modules' && (
        <TabBody>
          {parts.length > 0 && (
            <AdminPanel title={t('adminEventsV2.gl.parts', 'Parts of the event')} description={t('adminEventsV2.gl.partsDesc', 'Guests say which parts they attend.')}>
              <Facts items={parts.map((p, i) => ({ label: p.label || p.key || `Part ${i + 1}`, value: p.when || '—' }))} />
              {g && (g.conference > 0 || g.gala > 0) && (
                <p className="mt-4 text-[14px] text-meta">{t('adminEventsV2.gl.partsCount', 'Guests in: {{c}} for the conference, {{g}} for the gala dinner.', { c: g.conference, g: g.gala })}</p>
              )}
            </AdminPanel>
          )}
          <TabNote>{t('adminEventsV2.gl.modules', 'The programme tools of Smart Marina (badges, agenda, networking, e-catalogue, jury, awards, feedback) come to every on-site event after the World Yachting Summit. The door check-in already works for this event.')}</TabNote>
          <GoPanel title={t('adminEventsV2.gl.toolsNow', 'Available now')}>{doorRow}</GoPanel>
        </TabBody>
      )}

      {tab === 'statistics' && (
        <TabBody>
          {failedNote}
          <div className="grid gap-5 lg:grid-cols-2">
            <Breakdown title={t('adminEventsV2.byStatus', 'Guests by status')} rows={g ? topEntries(g.byStatus, 10, k => GUEST_STATUS_WORD[k] ?? words(k)) : []} />
            <Breakdown title={t('adminEventsV2.bySource', 'How they came')} rows={g ? topEntries(g.bySource, 8, sourceWord) : []} />
            <Breakdown title={t('adminEventsV2.byCountry', 'Guests by country')} rows={g ? topEntries(g.byCountry, 10) : []} />
            <Breakdown title={t('adminEventsV2.perWeek', 'New rows per week')} rows={g ? g.weeks.map(w => ({ label: weekLabel(w.week), n: w.n })) : []} />
          </div>
        </TabBody>
      )}

      {tab === 'settings' && (
        <TabBody>
          <GoPanel title={t('adminEventsV2.gl.settingsTitle', 'Where this event is set up')} description={t('adminEventsV2.gl.settingsDesc', 'Places, requests from the site and the texts guests see are set in the guest list; the public page in the event editor.')}>
            <GoRow to={base} icon={SlidersHorizontal} title={t('adminEventsV2.gl.settingsList', 'Guest list settings')} meta={t('adminEventsV2.gl.settingsListMeta', 'Places, requests open or closed, the e-mail for alerts')} cue={t('adminEventsV2.gl.openList', 'Open the guest list')} />
            {invRow}
            {editPublic && <GoRow to={editPublic} icon={PenLine} title={t('adminEventsV2.publicPage', 'The public event page')} meta={t('adminEventsV2.publicPageMeta', 'Title, dates, text and photo')} cue={t('adminEventsV2.changePublic', 'Change the public page')} />}
            {publicHref && <GoRow href={publicHref} icon={Mail} title={t('adminEventsV2.seePublic', 'See it as visitors do')} meta={publicHref} cue={t('adminEventsV2.viewPublic', 'View the public page')} />}
          </GoPanel>
        </TabBody>
      )}
    </div>
  );
}
