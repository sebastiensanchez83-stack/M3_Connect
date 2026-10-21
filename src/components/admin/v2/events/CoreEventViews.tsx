import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ClipboardList, ExternalLink, Link2, Mail, MailCheck, PenLine, QrCode, Settings2, Tag, UserCheck, UserPlus, Users,
} from 'lucide-react';
import { AdminPanel } from '../../AdminUI';
import { formatInZone, paymentWord, wallToIso, type LoadedEvent } from '../../events/eventAdmin';
import type { EditorForm, EditorTab } from '../../events/editorModel';
import {
  Breakdown, Facts, Figures, GoPanel, GoRow, TabBody, TabNote,
} from './EventPageKit';
import {
  fmtDay, GUEST_STATUS_WORD, sourceWord, guestFigures, loadCampaigns, loadGuestFacts, loadGuestListMails, money, tally, topEntries, weekLabel, words,
  type CampaignFact, type GuestFact, type MailFact,
} from './eventsApi';

/**
 * The read-only tabs of an event made with the new event editor: Overview, Check-in,
 * Invitations, Payments, Statistics, and the "sent so far" line of E-mails. Every action stays
 * where it already is in the editor (People registered: decisions, invitations, attendance;
 * Settings: the event itself): these tabs show figures and say, with a pill, where to go.
 */

export type CoreView = 'overview' | 'checkin' | 'invitations' | 'payments' | 'statistics';
type Go = (view: EditorTab | CoreView) => void;

interface CoreFacts {
  guests: GuestFact[] | null;
  mails: MailFact[] | null;
  campaigns: CampaignFact[] | null;
}

/** The facts of one event, read again when the number of registrations changes. */
export function useCoreFacts(glId: string | null, regCount: number): CoreFacts | null {
  const [facts, setFacts] = useState<{ key: string; value: CoreFacts } | null>(null);
  const key = `${glId}:${regCount}`;
  useEffect(() => {
    if (!glId) return;
    let alive = true;
    const soft = <T,>(p: Promise<T>) => p.catch(() => null);
    Promise.all([soft(loadGuestFacts(glId)), soft(loadGuestListMails(glId)), soft(loadCampaigns(glId))])
      .then(([guests, mails, campaigns]) => { if (alive) setFacts({ key, value: { guests, mails, campaigns } }); });
    return () => { alive = false; };
  }, [glId, key]);
  return facts?.value ?? null;
}

const modeWords = (mode: string, publicRequests: boolean, kind: string) => {
  if (mode === 'instant') return kind === 'webinar' ? 'Open: people are registered at once' : 'Open: people are confirmed at once';
  if (mode === 'review') return 'People ask, M3 decides';
  if (mode === 'invitation') return publicRequests ? 'By invitation (people can also ask)' : 'By invitation only';
  return words(mode);
};

export function CoreEventView({
  view,
  loaded,
  saved,
  facts,
  onGo,
  publicHref,
  onsiteLive,
  canInvite,
  available,
}: {
  view: CoreView;
  loaded: LoadedEvent;
  /** The event as saved (not the form being typed). */
  saved: EditorForm;
  facts: CoreFacts | null;
  onGo: Go;
  publicHref: string | null;
  /** On-site registration is live for this event (decisions, invitations, the door). */
  onsiteLive: boolean;
  /** "Invite people" exists in People registered for this event. */
  canInvite: boolean;
  /** The parts this page shows now: a button that leads to a part not shown is not drawn (no dead button). */
  available: (EditorTab | CoreView)[];
}) {
  const { t } = useTranslation();
  const b = saved.basics;
  const kind = b.kind;
  const gl = loaded.gl;
  const fig = facts?.guests ? guestFigures(facts.guests) : null;
  const val = (n: number | undefined) => (fig ? n ?? 0 : null);
  const capacity = gl.capacity && gl.capacity > 0 ? gl.capacity : null;
  const startIso = b.start ? wallToIso(b.start, b.timezone) : null;
  const when = startIso ? formatInZone(startIso, b.timezone, !b.isFullDay) : t('adminEventsV2.noDate', 'Date to be set');
  const started = !!startIso && Date.parse(startIso) <= Date.now();
  const registerPath = `/register/${gl.slug}`;
  const can = (v: EditorTab | CoreView) => available.includes(v);
  // An on-site event while its on-site editor is closed: Settings shows Basics only.
  const laterNote = (text: string) => <TabNote>{text}</TabNote>;
  const readError = facts && !facts.guests && (
    <TabNote tone="warning">{t('adminEventsV2.core.readError', 'The registrations could not be read for these figures. Reload the page to try again.')}</TabNote>
  );

  const regsRow = (
    <GoRow onClick={() => onGo('registrations')} icon={Users} title={t('adminEventsV2.core.people', 'People registered')} meta={t('adminEventsV2.core.peopleMeta', 'See everyone, decide on requests, mark who attended, download the list')} cue={t('adminEventsV2.core.openRegs', 'Open the registrations')} />
  );

  if (view === 'overview') {
    return (
      <TabBody>
        {readError}
        {b.visibility === 'draft' && (
          <TabNote>{t('adminEventsV2.core.draft', 'This event is a draft: nobody sees it yet. Publish it in Settings, Basics, when it is ready.')}</TabNote>
        )}
        {b.visibility === 'hidden' && (
          <TabNote>{t('adminEventsV2.core.hidden', 'This is a hidden test event: it is not listed on the site and works only by its direct link, with test addresses.')}</TabNote>
        )}
        <Figures items={[
          { label: t('adminEventsV2.fig.registered', 'Registered'), value: val(fig?.registered), onClick: () => onGo('registrations') },
          { label: t('adminEventsV2.fig.waiting', 'Waiting for a decision'), value: val(fig?.waiting), onClick: () => onGo('registrations'), tone: fig?.waiting ? 'attention' : 'default' },
          kind === 'onsite'
            ? { label: t('adminEventsV2.fig.invited', 'Invited, no answer yet'), value: val(fig?.invited), onClick: () => onGo('invitations') }
            : { label: t('adminEventsV2.fig.attended', 'Marked as attended'), value: val(fig?.checkedInOfIn), onClick: () => onGo('checkin') },
          { label: t('adminEventsV2.fig.places', 'Places'), value: capacity ?? t('adminEventsV2.noLimit', 'No limit'), onClick: can('registration') ? () => onGo('registration') : undefined },
        ]} />
        <AdminPanel title={t('adminEventsV2.atAGlance', 'At a glance')}>
          <Facts items={[
            { label: t('adminEventsV2.when', 'When'), value: when },
            { label: t('adminEventsV2.where', 'Where'), value: kind === 'webinar' ? t('adminEventsV2.online', 'Online') : b.location || [b.venue, b.city].filter(Boolean).join(', ') },
            { label: t('adminEventsV2.core.how', 'How people register'), value: t(`adminEventsV2.core.mode.${saved.registration.mode}`, modeWords(saved.registration.mode, saved.registration.publicRequests, kind)) },
            { label: t('adminEventsV2.core.closes', 'Registration closes'), value: gl.closes_at ? formatInZone(gl.closes_at, b.timezone) : t('adminEventsV2.core.closesNotSet', 'No closing date set') },
            { label: t('adminEventsV2.core.registerPage', 'Registration page'), value: registerPath },
            { label: t('adminEventsV2.core.access', 'Who can register'), value: saved.registration.access === 'members' ? t('adminEventsV2.core.members', 'Signed-in members only') : t('adminEventsV2.core.everyone', 'Everyone') },
          ]} />
        </AdminPanel>
        <GoPanel title={t('adminEventsV2.whatToDo', 'What you can do')} description={t('adminEventsV2.core.whatToDoDesc', 'Everything about this event is handled on this page. Each button says where it leads.')}>
          {regsRow}
          <GoRow onClick={() => onGo('basics')} icon={PenLine} title={t('adminEventsV2.core.basics', 'Title, date, place and description')} meta={t('adminEventsV2.core.basicsMeta', 'Also: publish the event or keep it as a draft')} cue={t('adminEventsV2.core.change', 'Change them')} />
          {can('registration') && (
            <GoRow onClick={() => onGo('registration')} icon={Settings2} title={t('adminEventsV2.core.howTitle', 'How people register')} meta={t('adminEventsV2.core.howMeta', 'Open or by request, places, dates, the fields people fill in')} cue={t('adminEventsV2.core.change', 'Change them')} />
          )}
          <GoRow onClick={() => onGo('emails')} icon={Mail} title={t('adminEventsV2.core.mails', 'E-mails people receive')} meta={kind === 'webinar' ? t('adminEventsV2.core.mailsMetaWebinar', 'Reminders, the online link, the replay') : t('adminEventsV2.core.mailsMetaOnsite', 'Confirmation, reminders, the M3 team alert')} cue={t('adminEventsV2.core.see', 'See them')} />
          {publicHref && b.visibility === 'published' && (
            <GoRow href={publicHref} icon={ExternalLink} title={t('adminEventsV2.seePublic', 'See it as visitors do')} meta={publicHref} cue={t('adminEventsV2.viewPublic', 'View the public page')} />
          )}
        </GoPanel>
        {!can('registration') && laterNote(t('adminEventsV2.core.regLater', 'How people register, the places and the participation types are set in the on-site editor, which opens when on-site registration is live on the site.'))}
      </TabBody>
    );
  }

  if (view === 'checkin') {
    if (kind === 'webinar') {
      const recorded = (gl.settings || {}).attendance_recorded === true;
      return (
        <TabBody>
          {readError}
          <Figures items={[
            { label: t('adminEventsV2.fig.registered', 'Registered'), value: val(fig?.registered) },
            { label: t('adminEventsV2.fig.attended', 'Marked as attended'), value: val(fig?.checkedInOfIn) },
            { label: t('adminEventsV2.fig.absent', 'Not marked'), value: fig ? Math.max(0, fig.registered - fig.checkedInOfIn) : null },
          ]} />
          <TabNote>
            {!started
              ? t('adminEventsV2.core.attendLater', 'A webinar has no door. After it starts, mark who attended (paste the list from Zoom or Teams), then say that attendance is complete: only then do the others get the "Sorry we missed you" e-mail.')
              : recorded
                ? t('adminEventsV2.core.attendDone', 'Attendance is marked as complete. People not marked as attended get the "Sorry we missed you" e-mail.')
                : t('adminEventsV2.core.attendNow', 'Mark who attended (paste the list from Zoom or Teams), then press "Attendance is complete": only then do the others get the "Sorry we missed you" e-mail.')}
          </TabNote>
          <GoPanel title={t('adminEventsV2.core.attendWhere', 'Attendance is marked in the list of people registered')}>
            <GoRow onClick={() => onGo('registrations')} icon={UserCheck} title={t('adminEventsV2.core.markTitle', 'Mark who attended')} meta={t('adminEventsV2.core.markMeta', 'One by one, or by pasting a list of e-mail addresses')} cue={t('adminEventsV2.core.openRegs', 'Open the registrations')} />
          </GoPanel>
        </TabBody>
      );
    }
    return (
      <TabBody>
        {readError}
        <Figures items={[
          { label: t('adminEventsV2.fig.expected', 'Guests expected'), value: val(fig?.expected), hint: t('adminEventsV2.fig.expectedHint', 'Confirmed people') },
          { label: t('adminEventsV2.fig.checkedIn', 'People checked in at the door'), value: val(fig?.arrived), hint: fig?.arrivedOther ? t('adminEventsV2.fig.arrivedOther', 'Also {{n}} let in without a confirmed registration', { n: fig.arrivedOther }) : undefined },
          { label: t('adminEventsV2.fig.notYet', 'Not arrived yet'), value: fig ? Math.max(0, fig.expected - fig.arrived) : null },
        ]} />
        {!onsiteLive && (
          <TabNote>{t('adminEventsV2.core.doorNotLive', 'On-site registration is not live on the site yet: the door lists people once M3 confirms them.')}</TabNote>
        )}
        <GoPanel title={t('adminEventsV2.core.doorWhere', 'The door works on any phone')}>
          <GoRow to={`/admin/guest-list/${encodeURIComponent(gl.slug)}/checkin`} icon={QrCode} title={t('adminEventsV2.core.doorTitle', 'Door check-in')} meta={t('adminEventsV2.core.doorMeta', 'Scan the QR code of each confirmed person, or find them by name')} cue={t('adminEventsV2.core.openDoor', 'Open the door check-in')} />
        </GoPanel>
      </TabBody>
    );
  }

  if (view === 'invitations') {
    const camps = facts?.campaigns ?? [];
    const accepted = fig ? (facts?.guests ?? []).filter(g => g.source === 'invitation' && ['confirmed', 'approved'].includes(g.status)).length : 0;
    return (
      <TabBody>
        {readError}
        <Figures items={[
          { label: t('adminEventsV2.fig.invited', 'Invited, no answer yet'), value: val(fig?.invited) },
          { label: t('adminEventsV2.fig.acceptedInv', 'Accepted an invitation'), value: fig ? accepted : null },
          { label: t('adminEventsV2.fig.declined', 'Declined'), value: val(fig?.declined) },
        ]} />
        {kind === 'webinar' ? (
          <TabNote>
            {t('adminEventsV2.core.invWebinar', 'Personal invitations are sent for on-site events. To bring people to a webinar, share its registration page: {{path}}', { path: registerPath })}
          </TabNote>
        ) : canInvite ? (
          <GoPanel title={t('adminEventsV2.core.invWhere', 'Invitations are sent from the list of people registered')}>
            <GoRow onClick={() => onGo('registrations')} icon={UserPlus} title={t('adminEventsV2.core.inviteTitle', 'Invite people')} meta={t('adminEventsV2.core.inviteMeta', 'Paste names and e-mail addresses; each person gets a personal link')} cue={t('adminEventsV2.core.openRegs', 'Open the registrations')} />
          </GoPanel>
        ) : (
          <TabNote>
            {onsiteLive
              ? t('adminEventsV2.core.invNotMode', 'Personal invitations are for events "by invitation", or with a participation type kept for invited people. Change that in Settings, How to register.')
              : t('adminEventsV2.core.invNotLive', 'Personal invitations open once on-site registration is live on the site (or on a hidden test event).')}
          </TabNote>
        )}
        {camps.length > 0 && (
          <GoPanel title={t('adminEventsV2.core.campaigns', 'Invitation campaigns of this event')} description={t('adminEventsV2.core.campaignsDesc', 'Tickets and letters in PDF, prepared in the invitations screen.')}>
            {camps.map(c => (
              <GoRow key={c.id} to={`/admin/guest-list/${encodeURIComponent(gl.slug)}/invitations/${c.id}`} icon={Mail} title={c.name} meta={t('adminEventsV2.core.campaignMeta', '{{n}} people on the list', { n: c.total })} cue={t('adminEventsV2.open', 'Open')} />
            ))}
          </GoPanel>
        )}
      </TabBody>
    );
  }

  if (view === 'payments') {
    const prices = loaded.tickets.filter(tk => tk.active);
    return (
      <TabBody>
        {readError}
        <TabNote>{t('adminEventsV2.core.payNote', 'Prices are shown to people when they register. Paying on the site is not switched on yet: payments are followed by hand, on each registration.')}</TabNote>
        <AdminPanel title={t('adminEventsV2.core.prices', 'Participation types and prices')} icon={Tag}>
          {prices.length === 0 ? (
            <p className="text-[14px] text-meta">{t('adminEventsV2.core.noTypes', 'No participation type yet.')}</p>
          ) : (
            <Facts items={prices.map(tk => ({
              label: tk.label,
              value: tk.price_cents ? `${money(tk.price_cents, tk.currency || 'EUR')}${tk.price_note ? ` (${tk.price_note})` : ''}` : (tk.price_note || t('adminEventsV2.core.free', 'Free')),
            }))} />
          )}
        </AdminPanel>
        <Breakdown
          title={t('adminEventsV2.core.payStates', 'Payments of the people registered')}
          rows={fig ? topEntries(fig.byPayment, 8, k => paymentWord(k, t)) : []}
          empty={t('adminEventsV2.core.noPay', 'Nobody has anything to pay yet.')}
        />
        <GoPanel title={t('adminEventsV2.core.payWhere', 'Where payments are handled')}>
          {can('tickets') && (
            <GoRow onClick={() => onGo('tickets')} icon={Tag} title={t('adminEventsV2.core.pricesTitle', 'Participation types and prices')} meta={t('adminEventsV2.core.pricesMeta', 'In Settings')} cue={t('adminEventsV2.core.change', 'Change them')} />
          )}
          <GoRow onClick={() => onGo('registrations')} icon={ClipboardList} title={t('adminEventsV2.core.payPeople', 'Who has paid')} meta={t('adminEventsV2.core.payPeopleMeta', 'Filter the list of people registered by payment')} cue={t('adminEventsV2.core.openRegs', 'Open the registrations')} />
        </GoPanel>
        {!can('tickets') && laterNote(t('adminEventsV2.core.ticketsLater', 'Participation types and prices are changed in the on-site editor, which opens when on-site registration is live on the site.'))}
      </TabBody>
    );
  }

  // statistics
  const tickets = loaded.tickets;
  return (
    <TabBody>
      {readError}
      <div className="grid gap-5 lg:grid-cols-2">
        <Breakdown title={t('adminEventsV2.byStatus', 'Registrations by status')} rows={fig ? topEntries(fig.byStatus, 10, k => GUEST_STATUS_WORD[k] ?? words(k)) : []} empty={t('adminEventsV2.noGuests', 'Nobody registered yet.')} />
        {kind === 'onsite' && (
          <Breakdown
            title={t('adminEventsV2.byTicket', 'People in, by participation type')}
            rows={fig ? topEntries(fig.byTicket, 10, k => tickets.find(tk => tk.key === k)?.label ?? (k ? words(k) : t('adminEventsV2.noType', 'No type'))) : []}
          />
        )}
        <Breakdown title={t('adminEventsV2.bySource', 'How they came')} rows={fig ? topEntries(fig.bySource, 8, sourceWord) : []} />
        <Breakdown title={t('adminEventsV2.byCountry', 'Registrations by country')} rows={fig ? topEntries(fig.byCountry, 10) : []} />
        <Breakdown title={t('adminEventsV2.perWeek', 'Registrations per week')} rows={fig ? fig.weeks.map(w => ({ label: weekLabel(w.week), n: w.n })) : []} />
      </div>
    </TabBody>
  );
}

/** E-mails tab, above the settings: what has gone out so far. */
export function CoreMailsSent({ facts }: { facts: CoreFacts | null }) {
  const { t } = useTranslation();
  const mails = facts?.mails ?? null;
  const byKind = tally((mails ?? []).map(m => m.kind));
  return (
    <AdminPanel
      title={t('adminEventsV2.core.sentTitle', 'Sent so far')}
      icon={MailCheck}
      description={mails === null ? t('adminEventsV2.core.sentUnknown', 'Not readable right now.') : mails.length === 0
        ? t('adminEventsV2.noMails', 'No e-mail sent yet.')
        : t('adminEventsV2.core.sentDesc', '{{n}} e-mails, the last one on {{d}}.', { n: mails.length, d: fmtDay(mails[0]?.sent_at) })}
      actions={(
        <Link to="/admin/email-log" className="inline-flex min-h-10 items-center gap-1.5 rounded-pill border border-navy/55 bg-white px-3 text-[14px] font-semibold text-navy hover:border-navy hover:bg-chip focus:outline-none focus-visible:shadow-focus">
          <Link2 className="h-4 w-4" aria-hidden="true" />
          {t('adminEventsV2.openMailLog', 'Open the e-mail log')}
        </Link>
      )}
    >
      {mails && mails.length > 0 ? (
        <Facts items={topEntries(byKind, 8, words).map(r => ({ label: r.label, value: String(r.n) }))} />
      ) : (
        <p className="text-[14px] text-meta">{t('adminEventsV2.core.sentNone', 'Confirmations, reminders and other e-mails of this event will be counted here.')}</p>
      )}
    </AdminPanel>
  );
}
