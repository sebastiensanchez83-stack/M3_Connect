import type { TFunction } from 'i18next';
import {
  DEFAULT_TIMEZONE, RESERVED_SLUGS, SLUG_RE, STANDARD_FIELDS, emailList, isEmail, isHttpsUrl, isoToWall,
  wallToIso, type EventKind, type EventPart, type FieldRule, type LoadedEvent, type QuestionRow, type RegistrationMode,
  type StandardField, type TicketRow,
} from './eventAdmin';

/**
 * The editor's form, tab by tab, and how it becomes ONE admin_save_event payload.
 * Only the FIELDS that changed since the form was loaded are sent (a key left out keeps
 * its stored value): a form left open in another tab or by another person never puts
 * back an old "published", join link or replay link it did not touch.
 *
 * gl_event.settings keys written here and read by registration-cron / registration
 * (not listed in the DB contract, which says only "settings (merged)"):
 *   timezone            IANA zone of the event's wall-clock times (default Europe/Monaco)
 *   no_reminders        true = no reminder e-mails for this event
 *   contact_email       reply-to of the registrants' e-mails (empty = events@m3monaco.com)
 *   attendance_recorded true = staff pressed "Attendance is complete" (absentees get
 *                       "Sorry we missed you"); false = not yet (never); ABSENT = the cron
 *                       guesses: absentees known 30 minutes after the last attendance mark.
 *                       The editor writes false on create, on duplicate, and before the first
 *                       mark of an event that has no value yet.
 * On-site events (Phase 3, behind onsite_v2):
 *   practical_info      printed in the on-site confirmation and reminder e-mails (read today)
 *   parts               [{key, label, when}]: the parts of the event (conference, gala dinner),
 *                       the shape wys26 uses; gl_ticket.parts and a question of kind "parts"
 *                       refer to their keys
 *   email_intros        {template: text}: M3's own opening paragraph per e-mail. NOT read by
 *                       the registration function yet (gap for the integrator, see the
 *                       EVENT lane report); saved so the texts are ready when it is. The
 *                       E-mails tab says so until the function answers email_intros: true
 *                       to {action: 'capabilities'} (eventAdmin RegistrationCaps).
 */

export type EditorTab = 'basics' | 'registration' | 'tickets' | 'questions' | 'emails' | 'registrations' | 'modules';
export type Visibility = 'draft' | 'published' | 'hidden';

export interface Speaker { name: string; title: string }

export interface BasicsForm {
  title: string;
  slug: string;
  kind: EventKind;
  timezone: string;
  start: string;
  end: string;
  isFullDay: boolean;
  /** The one-line place (events.location): typed for webinars and the limited on-site editor, built from venue + city otherwise. */
  location: string;
  /** On-site: events.location_details (the event page shows venue, address, city, country). */
  venue: string;
  address: string;
  city: string;
  country: string;
  /** Other keys of location_details (map_url, lat, lng): never edited here, always kept. */
  locationExtra: Record<string, unknown>;
  meetingUrl: string;
  imageUrl: string;
  description: string;
  speakers: Speaker[];
  website: string;
  visibility: Visibility;
  sectorIds: string[];
}

export type AccountEmailTiming = 'with_confirmation' | 'after_event';

export interface RegistrationForm {
  mode: RegistrationMode;
  publicRequests: boolean;
  access: 'public' | 'members';
  capacity: string;
  waitlist: boolean;
  opensAt: string;
  closesAt: string;
  editLocksAt: string;
  fields: Record<StandardField, FieldRule>;
  /** On-site: when the "choose your password" e-mail goes once M3 confirms someone. */
  accountEmailTiming: AccountEmailTiming;
  /** On-site, after the event: the date (wall clock in the event's zone); empty = the day after the event ends. */
  accountEmailSendAt: string;
  /** gl_event.plus_ones as stored: display only (plus-ones of the new system come in December). */
  plusOnes: number;
}

export interface QuestionsForm { list: QuestionRow[] }

/** One participation type as the editor holds it (strings for the number fields). */
export interface TicketDraft {
  key: string;
  label: string;
  description: string;
  /** Euros, display only ("" = no price shown). */
  price: string;
  priceNote: string;
  inviteOnly: boolean;
  capacity: string;
  allowedTypes: string[];
  parts: string[];
  active: boolean;
}

export interface TicketsForm { list: TicketDraft[]; parts: EventPart[] }

/** The e-mails whose opening paragraph M3 can write (on-site, registration function templates). */
export const INTRO_TEMPLATES = [
  'reg_received', 'reg_confirmed', 'reg_waitlisted', 'reg_info_requested', 'reg_not_accepted', 'reg_invitation', 'reg_reminder',
] as const;
export type IntroTemplate = typeof INTRO_TEMPLATES[number];
export const INTRO_MAX = 1000;

export interface EmailsForm {
  remindersOn: boolean;
  reminders: string[];
  replayUrl: string;
  replayPublic: boolean;
  notifyEmail: string;
  staffAlertMode: 'each' | 'digest';
  contactEmail: string;
  /** On-site: settings.practical_info. */
  practicalInfo: string;
  /** On-site: settings.email_intros. */
  intros: Partial<Record<IntroTemplate, string>>;
}

export interface EditorForm {
  basics: BasicsForm;
  registration: RegistrationForm;
  tickets: TicketsForm;
  questions: QuestionsForm;
  emails: EmailsForm;
}

export type FormSection = keyof EditorForm;
export const SECTIONS: FormSection[] = ['basics', 'registration', 'tickets', 'questions', 'emails'];

/** The "M3 team" fields: in E-mails for webinars, in Basics for on-site events (spec §8.2). */
export const STAFF_FIELDS: (keyof EmailsForm)[] = ['notifyEmail', 'staffAlertMode', 'contactEmail'];

/** What the reminder e-mails send by default (registration-cron, when the list is empty). */
export const DEFAULT_REMINDERS: Record<EventKind, string[]> = { webinar: ['P7D', 'P1D', 'PT1H'], onsite: ['P7D'] };

/** Who at M3 hears about new registrations by default (also the reply-to fallback of the e-mails). */
export const M3_EVENTS_EMAIL = 'events@m3monaco.com';

/** A webinar without an account asks name, e-mail and (optionally) company (Victor, 6 Oct). */
const NEW_WEBINAR_FIELDS: Record<StandardField, FieldRule> = {
  company: 'optional', job_title: 'hidden', phone: 'hidden', country: 'hidden',
};

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Staff alerts by default: open registration needs no decision, so one summary a day
 * (a popular webinar would otherwise send hundreds of alerts); when M3 accepts each
 * person, one e-mail per request.
 */
export function defaultAlertMode(mode: RegistrationMode): 'each' | 'digest' {
  return mode === 'instant' ? 'digest' : 'each';
}

/** "Yacht Club de Monaco" + "Monaco" -> "Yacht Club de Monaco, Monaco" (events.location of an on-site event). */
export function placeLine(venue: string, city: string): string {
  return [venue.trim(), city.trim()].filter(Boolean).join(', ');
}

/** Cents -> "1,250.50" style input text ("" when no price). */
function priceText(cents: number | null): string {
  if (cents === null || cents === undefined) return '';
  return cents % 100 ? (cents / 100).toFixed(2) : String(cents / 100);
}

/** "1250", "1250.5", "1 250,50" -> cents; null when empty; NaN when unreadable. */
export function priceCents(v: string): number | null {
  const s = v.replace(/[\s ]/g, '').replace(',', '.');
  if (!s) return null;
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(s)) return Number.NaN;
  return Math.round(Number(s) * 100);
}

export function ticketDraft(tk: TicketRow): TicketDraft {
  return {
    key: tk.key,
    label: tk.label,
    description: tk.description || '',
    price: priceText(tk.price_cents),
    priceNote: tk.price_note || '',
    inviteOnly: tk.invite_only,
    capacity: tk.capacity != null ? String(tk.capacity) : '',
    allowedTypes: [...(tk.allowed_company_types || [])].sort(),
    parts: [...(tk.parts || [])],
    active: tk.active,
  };
}

function partsFromSettings(v: unknown): EventPart[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter(isObj)
    .map((p) => ({ key: str(p.key), label: str(p.label), when: str(p.when) }))
    .filter((p) => /^[a-z0-9_]{1,40}$/.test(p.key));
}

function introsFromSettings(v: unknown): Partial<Record<IntroTemplate, string>> {
  const out: Partial<Record<IntroTemplate, string>> = {};
  if (!isObj(v)) return out;
  for (const k of INTRO_TEMPLATES) if (typeof v[k] === 'string' && (v[k] as string).trim()) out[k] = v[k] as string;
  return out;
}

export function newForm(kind: EventKind): EditorForm {
  const mode: RegistrationMode = kind === 'webinar' ? 'instant' : 'review';
  return {
    basics: {
      title: '', slug: '', kind, timezone: DEFAULT_TIMEZONE, start: '', end: '', isFullDay: false,
      location: '', venue: '', address: '', city: '', country: '', locationExtra: {},
      meetingUrl: '', imageUrl: '', description: '', speakers: [], website: '',
      visibility: 'draft', sectorIds: [],
    },
    registration: {
      mode,
      publicRequests: true,
      access: 'public',
      capacity: '',
      waitlist: false,
      opensAt: '',
      closesAt: '',
      editLocksAt: '',
      fields: kind === 'webinar' ? { ...NEW_WEBINAR_FIELDS } : { company: 'required', job_title: 'required', phone: 'optional', country: 'optional' },
      accountEmailTiming: 'with_confirmation',
      accountEmailSendAt: '',
      plusOnes: 0,
    },
    tickets: { list: [], parts: [] },
    questions: { list: [] },
    emails: {
      remindersOn: true,
      reminders: [...DEFAULT_REMINDERS[kind]],
      replayUrl: '',
      replayPublic: false,
      // Someone at M3 must hear about requests: an empty address alerts nobody.
      notifyEmail: M3_EVENTS_EMAIL,
      staffAlertMode: defaultAlertMode(mode),
      contactEmail: '',
      practicalInfo: '',
      intros: {},
    },
  };
}

export function formFromLoaded(l: LoadedEvent): EditorForm {
  const { gl, catalogue: c } = l;
  const s = (gl.settings || {}) as Record<string, unknown>;
  const kind: EventKind = gl.kind === 'onsite' ? 'onsite' : 'webinar';
  const tz = str(s.timezone) || DEFAULT_TIMEZONE;
  const start = c?.date_time ?? str(s.starts_at);
  const end = c?.end_date_time ?? str(s.ends_at);
  const visibility: Visibility = gl.hidden ? 'hidden' : c?.published ? 'published' : 'draft';
  const fields = { company: 'optional', job_title: 'optional', phone: 'optional', country: 'optional' } as Record<StandardField, FieldRule>;
  for (const f of STANDARD_FIELDS) {
    const v = gl.standard_fields?.[f];
    if (v === 'required' || v === 'optional' || v === 'hidden') fields[f] = v;
  }
  const reminders = Array.isArray(gl.reminders) && gl.reminders.length ? gl.reminders.filter((r) => typeof r === 'string') : DEFAULT_REMINDERS[kind];
  const replay = gl.replay_url || '';
  const ld = isObj(c?.location_details) ? (c!.location_details as Record<string, unknown>) : {};
  const { venue: ldVenue, address: ldAddress, city: ldCity, country: ldCountry, ...locationExtra } = ld;
  const hasDetails = [ldVenue, ldAddress, ldCity, ldCountry].some((x) => typeof x === 'string' && x.trim());
  return {
    basics: {
      title: c?.title || gl.title || '',
      slug: gl.slug || '',
      kind,
      timezone: tz,
      start: isoToWall(start || null, tz),
      end: isoToWall(end || null, tz),
      isFullDay: !!c?.is_full_day,
      location: c?.location || '',
      // An on-site event saved before the structured fields: its one line becomes the venue.
      venue: hasDetails ? str(ldVenue) : (kind === 'onsite' ? c?.location || '' : ''),
      address: str(ldAddress),
      city: str(ldCity),
      country: str(ldCountry),
      locationExtra,
      meetingUrl: gl.meeting_url || '',
      imageUrl: c?.image_url || '',
      description: c?.description || '',
      speakers: (Array.isArray(c?.speakers) ? c!.speakers! : []).map((sp) => ({ name: str(sp?.name), title: str(sp?.title) })),
      website: c?.event_website_url || '',
      visibility,
      sectorIds: [...l.sectorIds].sort(),
    },
    registration: {
      mode: gl.registration_mode ?? (kind === 'webinar' ? 'instant' : 'review'),
      publicRequests: gl.public_requests !== false,
      access: gl.access === 'members' ? 'members' : 'public',
      capacity: gl.capacity != null ? String(gl.capacity) : '',
      waitlist: !!gl.waitlist,
      opensAt: isoToWall(gl.opens_at, tz),
      closesAt: isoToWall(gl.closes_at, tz),
      editLocksAt: isoToWall(gl.edit_locks_at, tz),
      fields,
      accountEmailTiming: gl.account_email_timing === 'after_event' ? 'after_event' : 'with_confirmation',
      accountEmailSendAt: isoToWall(gl.account_email_send_at ?? null, tz),
      plusOnes: Number(gl.plus_ones) || 0,
    },
    tickets: {
      list: (l.tickets || []).map(ticketDraft),
      parts: partsFromSettings(s.parts),
    },
    questions: { list: l.questions.map((q, i) => ({ ...q, display_order: i })) },
    emails: {
      remindersOn: s.no_reminders !== true,
      reminders: [...reminders],
      replayUrl: replay,
      replayPublic: !!replay && (c?.replay_url || '') === replay,
      notifyEmail: gl.notify_email || '',
      staffAlertMode: gl.staff_alert_mode === 'digest' ? 'digest' : 'each',
      contactEmail: str(s.contact_email),
      practicalInfo: str(s.practical_info),
      intros: introsFromSettings(s.email_intros),
    },
  };
}

const same = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y);

export function sectionDirty(a: EditorForm, b: EditorForm, section: FormSection): boolean {
  return !same(a[section], b[section]);
}

export function dirtySections(form: EditorForm, initial: EditorForm): FormSection[] {
  return SECTIONS.filter((s) => sectionDirty(form, initial, s));
}

/** The tabs with unsaved changes (the dot on the tab bar). On-site, the M3 team fields sit in Basics. */
export function dirtyTabs(form: EditorForm, initial: EditorForm): EditorTab[] {
  const onsite = form.basics.kind === 'onsite';
  const emailKeys = Object.keys(form.emails) as (keyof EmailsForm)[];
  const staffDirty = STAFF_FIELDS.some((k) => !same(form.emails[k], initial.emails[k]));
  const otherMailDirty = emailKeys.some((k) => !STAFF_FIELDS.includes(k) && !same(form.emails[k], initial.emails[k]));
  const out: EditorTab[] = [];
  if (sectionDirty(form, initial, 'basics') || (onsite && staffDirty)) out.push('basics');
  if (sectionDirty(form, initial, 'registration')) out.push('registration');
  if (sectionDirty(form, initial, 'tickets')) out.push('tickets');
  if (sectionDirty(form, initial, 'questions')) out.push('questions');
  if (onsite ? otherMailDirty : sectionDirty(form, initial, 'emails')) out.push('emails');
  return out;
}

/** Where the M3 team fields are shown (and their errors reported). */
export const staffTab = (kind: EventKind): EditorTab => (kind === 'onsite' ? 'basics' : 'emails');

/* ------------------------------------------------------------------ checks */

export interface FormIssue { tab: EditorTab; field: string; message: string }

const wholeNumber = (v: string) => /^\d+$/.test(v.trim());

/**
 * What must be fixed before saving. Only the tabs the editor shows are checked: an
 * on-site event without the on-site editor (Basics only) never gets an issue on a tab
 * it cannot open. `full` = the editor shows every tab of this kind (webinars always;
 * on-site events with onsite_v2 on, a hidden test, or ?editor=new).
 */
export interface CheckOptions {
  /** The registration function sends invitations (RegistrationCaps.invite). */
  invitesReady?: boolean;
  /** The event is SAVED as invitation only with requests off: it keeps saving as it is. */
  savedInviteOnly?: boolean;
}

export function checkForm(form: EditorForm, t: TFunction, full = form.basics.kind === 'webinar', opts: CheckOptions = {}): FormIssue[] {
  const out: FormIssue[] = [];
  const b = form.basics;
  const r = form.registration;
  const e = form.emails;
  const tz = b.timezone;
  const onsite = b.kind === 'onsite';
  const at = (wall: string) => (wall ? wallToIso(wall, tz) : null);
  const notComplete = t('adminEvents.check.dateIncomplete', 'This date is not complete.');

  if (!b.title.trim()) out.push({ tab: 'basics', field: 'title', message: t('adminEvents.err.title', 'Give the event a title.') });
  const slug = b.slug.trim();
  if (!slug) out.push({ tab: 'basics', field: 'slug', message: t('adminEvents.err.slug', 'Give the event a web address.') });
  else if (!SLUG_RE.test(slug) || slug.length > 60) {
    out.push({ tab: 'basics', field: 'slug', message: t('adminEvents.check.slug', 'Use lower-case letters, numbers and single dashes only (60 characters at most).') });
  } else if (RESERVED_SLUGS.includes(slug)) {
    out.push({ tab: 'basics', field: 'slug', message: t('adminEvents.err.slugReserved', 'This web address is reserved for another page. Choose another one.') });
  }
  if (b.start && !at(b.start)) out.push({ tab: 'basics', field: 'start', message: t('adminEvents.check.startIncomplete', 'The start date is not complete.') });
  if (b.end && !b.isFullDay) {
    const s = at(b.start);
    const en = at(b.end);
    if (!en) out.push({ tab: 'basics', field: 'end', message: t('adminEvents.check.endIncomplete', 'The end date is not complete.') });
    else if (s && en <= s) out.push({ tab: 'basics', field: 'end', message: t('adminEvents.check.endAfter', 'The end must be after the start.') });
  }
  if (b.visibility === 'published' && !b.start) {
    out.push({ tab: 'basics', field: 'start', message: t('adminEvents.check.dateFirst', 'Set the date before publishing the event.') });
  }
  if (b.kind === 'webinar' && b.meetingUrl.trim() && !isHttpsUrl(b.meetingUrl)) {
    out.push({ tab: 'basics', field: 'meetingUrl', message: t('adminEvents.check.meetingUrl', 'The join link must be a full address starting with https://') });
  }
  if (b.website.trim() && !/^https?:\/\/\S+\.\S+/i.test(b.website.trim())) {
    out.push({ tab: 'basics', field: 'website', message: t('adminEvents.check.website', 'The website must be a full address starting with https://') });
  }
  b.speakers.forEach((sp, i) => {
    if (!sp.name.trim() && sp.title.trim()) out.push({ tab: 'basics', field: `speaker${i}`, message: t('adminEvents.check.speaker', 'A speaker needs a name.') });
  });

  // The other tabs: webinars, and on-site events in the on-site editor.
  if (!full) return out;

  if (r.capacity.trim() && (!wholeNumber(r.capacity) || Number(r.capacity) < 1)) {
    out.push({ tab: 'registration', field: 'capacity', message: t('adminEvents.check.capacity', 'Write a whole number of places, or leave it empty for no limit.') });
  }
  const opens = r.opensAt ? at(r.opensAt) : null;
  const closes = r.closesAt ? at(r.closesAt) : null;
  if (r.opensAt && !opens) out.push({ tab: 'registration', field: 'opensAt', message: notComplete });
  if (r.closesAt && !closes) out.push({ tab: 'registration', field: 'closesAt', message: notComplete });
  if (opens && closes && closes <= opens) {
    out.push({ tab: 'registration', field: 'closesAt', message: t('adminEvents.check.closeAfterOpen', 'Registration must close after it opens.') });
  }
  if (r.editLocksAt && !at(r.editLocksAt)) out.push({ tab: 'registration', field: 'editLocksAt', message: notComplete });

  if (onsite) {
    if (r.mode === 'instant') {
      out.push({ tab: 'registration', field: 'mode', message: t('adminEvents.err.instant', 'Open registration works for webinars only. On-site events are checked by M3.') });
    }
    // Invitation only, requests off, and no invitations yet: nobody could register at all.
    if (r.mode === 'invitation' && !r.publicRequests && !opts.invitesReady && !opts.savedInviteOnly) {
      out.push({ tab: 'registration', field: 'mode', message: t('adminEvents.check.inviteNotYet', 'Sending invitations comes in a later update: with requests off, nobody could register. Turn "People can ask for an invitation" on.') });
    }
    if (r.accountEmailTiming === 'after_event' && r.accountEmailSendAt) {
      const sendAt = at(r.accountEmailSendAt);
      const startIso = at(b.start);
      const evEnd = b.isFullDay
        ? (startIso ? new Date(Date.parse(startIso) + 86400000).toISOString() : null)
        : at(b.end || b.start);
      if (!sendAt) out.push({ tab: 'registration', field: 'accountEmailSendAt', message: notComplete });
      else if (evEnd && sendAt < evEnd) {
        out.push({ tab: 'registration', field: 'accountEmailSendAt', message: t('adminEvents.check.accountAfter', 'Choose a date after the event, or pick "With the confirmation".') });
      }
    }

    const tk = form.tickets;
    tk.list.forEach((x, i) => {
      if (!x.label.trim()) out.push({ tab: 'tickets', field: `t${i}`, message: t('adminEvents.check.tLabel', 'Participation type {{n}} needs a name.', { n: i + 1 }) });
      if (x.capacity.trim() && (!wholeNumber(x.capacity) || Number(x.capacity) < 1)) {
        out.push({ tab: 'tickets', field: `t${i}`, message: t('adminEvents.check.tCapacity', 'Participation type {{n}}: write a whole number of places, or leave it empty.', { n: i + 1 }) });
      }
      if (x.price.trim() && Number.isNaN(priceCents(x.price) as number)) {
        out.push({ tab: 'tickets', field: `t${i}`, message: t('adminEvents.check.tPrice', 'Participation type {{n}}: write the price as a number of euros, like 450 or 450.50.', { n: i + 1 }) });
      }
    });
    tk.parts.forEach((p, i) => {
      if (!p.label.trim()) out.push({ tab: 'tickets', field: `p${i}`, message: t('adminEvents.check.pLabel', 'Part {{n}} of the event needs a name.', { n: i + 1 }) });
    });
    // Every type switched off is allowed: people then register without a type (contract
    // §2, gl_ticket). The Participation types tab says so, without blocking the save.
  }

  const ticketKeys = new Set(form.tickets.list.map((x) => x.key));
  form.questions.list.forEach((q, i) => {
    if (!q.label.trim()) out.push({ tab: 'questions', field: `q${i}`, message: t('adminEvents.check.qWording', 'Question {{n}} needs a wording.', { n: i + 1 }) });
    if ((q.kind === 'select' || q.kind === 'multiselect') && (q.options?.length ?? 0) < 2) {
      out.push({ tab: 'questions', field: `q${i}`, message: t('adminEvents.check.qChoices', 'Question {{n}} needs at least two choices.', { n: i + 1 }) });
    }
    if (q.kind === 'parts' && form.tickets.parts.length === 0) {
      out.push({ tab: 'questions', field: `q${i}`, message: t('adminEvents.check.qParts', 'Question {{n}} asks which parts people attend: add the parts in Participation types first.', { n: i + 1 }) });
    }
    if (onsite && q.ticket_keys?.length && !q.ticket_keys.some((k) => ticketKeys.has(k))) {
      out.push({ tab: 'questions', field: `q${i}`, message: t('adminEvents.check.qTickets', 'Question {{n}} is asked to participation types that no longer exist. Choose who it is for again.', { n: i + 1 }) });
    }
  });

  if (e.remindersOn && e.reminders.length === 0) {
    out.push({ tab: 'emails', field: 'reminders', message: t('adminEvents.check.reminders', 'Tick at least one reminder, or switch reminders off.') });
  }
  if (e.replayUrl.trim() && !isHttpsUrl(e.replayUrl)) {
    out.push({ tab: 'emails', field: 'replayUrl', message: t('adminEvents.check.replayUrl', 'The replay link must be a full address starting with https://') });
  }
  const st = staffTab(b.kind);
  // One address: the registration function sends staff alerts to exactly one recipient.
  if (e.notifyEmail.trim() && (emailList(e.notifyEmail).length !== 1 || !isEmail(e.notifyEmail))) {
    out.push({ tab: st, field: 'notifyEmail', message: t('adminEvents.check.notifyOne', 'Write one e-mail address (a shared mailbox works best).') });
  } else if (!e.notifyEmail.trim() && r.mode !== 'instant') {
    // M3 accepts each person: without an alert, requests wait with nobody knowing.
    out.push({ tab: st, field: 'notifyEmail', message: t('adminEvents.check.notifyNeeded', 'Choose who at M3 is told about new requests, or people will wait without anyone knowing.') });
  }
  if (e.contactEmail.trim() && !isEmail(e.contactEmail)) {
    out.push({ tab: st, field: 'contactEmail', message: t('adminEvents.check.contactEmail', 'This e-mail address is not valid.') });
  }
  return out;
}

/* ----------------------------------------------------------------- payload */

/** The options of a question of kind "parts": the event's parts, as they are now. */
export function partsOptions(parts: EventPart[]) {
  return parts.map((p) => ({ value: p.key, label: p.label.trim() || p.key }));
}

/**
 * The admin_save_event payload: every field when creating, otherwise ONLY the fields
 * that differ from `initial` (the form as loaded or last saved). `glEventId` is omitted
 * to create. Dates are read in the event's own time zone, so a new zone re-sends them.
 * Webinars never send the on-site keys (tickets, location_details, account e-mail
 * timing, practical information, e-mail intros, parts).
 */
export function buildPayload(form: EditorForm, initial: EditorForm, glEventId: string | null): Record<string, unknown> {
  const isNew = !glEventId;
  const b = form.basics;
  const r = form.registration;
  const e = form.emails;
  const onsite = b.kind === 'onsite';
  const tz = b.timezone;
  const tzChanged = b.timezone !== initial.basics.timezone;
  const iso = (wall: string) => (wall ? wallToIso(wall, tz) : null);
  const bChanged = (k: keyof BasicsForm) => isNew || !same(b[k], initial.basics[k]);
  const rChanged = (k: keyof RegistrationForm) => isNew || !same(r[k], initial.registration[k]);
  const eChanged = (k: keyof EmailsForm) => isNew || !same(e[k], initial.emails[k]);

  const event: Record<string, unknown> = {};
  const reg: Record<string, unknown> = {};
  const settings: Record<string, unknown> = {};
  const p: Record<string, unknown> = {};
  if (glEventId) p.id = glEventId;

  /* Basics */
  if (bChanged('title')) event.title = b.title.trim();
  if (bChanged('description')) event.description = b.description.trim();
  if (bChanged('start') || tzChanged) event.date_time = iso(b.start);
  if (bChanged('end') || bChanged('isFullDay') || tzChanged) event.end_date_time = b.isFullDay ? null : iso(b.end);
  if (bChanged('isFullDay')) event.is_full_day = b.kind === 'onsite' ? b.isFullDay : false;
  if (bChanged('location')) event.location = b.kind === 'onsite' ? b.location.trim() : '';
  if (onsite && (bChanged('venue') || bChanged('address') || bChanged('city') || bChanged('country'))) {
    // Replaced as a whole by admin_save_event: the keys not edited here go back as they were.
    const details: Record<string, unknown> = { ...b.locationExtra };
    for (const [k, v] of [['venue', b.venue], ['address', b.address], ['city', b.city], ['country', b.country]] as const) {
      if (v.trim()) details[k] = v.trim();
    }
    event.location_details = details;
  }
  if (bChanged('imageUrl')) event.image_url = b.imageUrl;
  if (bChanged('speakers')) {
    event.speakers = b.speakers
      .filter((sp) => sp.name.trim())
      .map((sp) => ({ name: sp.name.trim(), title: sp.title.trim() }));
  }
  if (bChanged('website')) event.event_website_url = b.website.trim();
  // Published and hidden go together, and only when the choice itself changed: a stale
  // form must never unpublish an event someone else published meanwhile.
  if (bChanged('visibility')) {
    event.published = b.visibility === 'published';
    reg.hidden = b.visibility === 'hidden';
  }
  if (bChanged('slug')) reg.slug = b.slug.trim();
  if (bChanged('meetingUrl')) reg.meeting_url = b.kind === 'webinar' ? b.meetingUrl.trim() : '';
  if (bChanged('timezone')) settings.timezone = tz;
  if (isNew) {
    reg.kind = b.kind;
    event.language = 'EN';
    // registration-cron sends "Sorry we missed you" only once staff say attendance is
    // complete (People registered tab). Without this key it would guess from the marks.
    if (b.kind === 'webinar') settings.attendance_recorded = false;
  }

  /* How to register (a new on-site event is made in the on-site editor: every field) */
  if (rChanged('opensAt') || tzChanged) reg.opens_at = iso(r.opensAt);
  if (rChanged('closesAt') || tzChanged) reg.closes_at = iso(r.closesAt);
  if (rChanged('editLocksAt') || tzChanged) reg.edit_locks_at = iso(r.editLocksAt);
  if (rChanged('mode')) reg.registration_mode = r.mode;
  if (rChanged('publicRequests')) reg.public_requests = r.publicRequests;
  if (rChanged('access')) reg.access = r.access;
  if (rChanged('capacity')) reg.capacity = r.capacity.trim() ? Number(r.capacity.trim()) : null;
  if (rChanged('waitlist')) reg.waitlist = r.waitlist;
  if (rChanged('fields')) reg.standard_fields = { ...r.fields };
  if (onsite) {
    if (rChanged('accountEmailTiming')) reg.account_email_timing = r.accountEmailTiming;
    if (rChanged('accountEmailTiming') || rChanged('accountEmailSendAt') || (tzChanged && !!r.accountEmailSendAt)) {
      reg.account_email_send_at = r.accountEmailTiming === 'after_event' ? iso(r.accountEmailSendAt) : null;
    }
  }

  /* Participation types: the full list (upsert by key; one left out is deleted, or switched off if used) */
  const partsChanged = onsite && (isNew || !same(form.tickets.parts, initial.tickets.parts));
  if (onsite && (isNew || !same(form.tickets.list, initial.tickets.list))) {
    p.tickets = form.tickets.list.map((x, i) => {
      const cents = priceCents(x.price);
      return {
        key: x.key,
        label: x.label.trim(),
        description: x.description.trim() || null,
        price_cents: cents === null || Number.isNaN(cents) ? null : cents,
        currency: 'EUR',
        price_note: x.priceNote.trim() || null,
        invite_only: x.inviteOnly,
        capacity: x.capacity.trim() ? Number(x.capacity.trim()) : null,
        allowed_company_types: x.allowedTypes.length ? [...x.allowedTypes] : null,
        // Only parts that still exist.
        parts: x.parts.filter((k) => form.tickets.parts.some((pt) => pt.key === k)),
        display_order: i,
        active: x.active,
      };
    });
  }
  if (partsChanged) {
    settings.parts = form.tickets.parts.map((pt) => ({ key: pt.key, label: pt.label.trim(), when: pt.when.trim() }));
  }

  /* Questions: the full list (upsert by key; a question left out is deleted) */
  const hasPartsQuestion = form.questions.list.some((q) => q.kind === 'parts');
  if (isNew || !same(form.questions, initial.questions) || (partsChanged && hasPartsQuestion)) {
    p.questions = form.questions.list.map((q, i) => ({
      key: q.key,
      label: q.label.trim(),
      help: q.help?.trim() || null,
      kind: q.kind,
      options: q.kind === 'select' || q.kind === 'multiselect'
        ? (q.options || [])
        : q.kind === 'parts' ? partsOptions(form.tickets.parts) : null,
      max_length: q.max_length ?? null,
      required: !!q.required,
      ticket_keys: q.ticket_keys && q.ticket_keys.length ? q.ticket_keys : null,
      profile_field: q.profile_field || null,
      editable_after_submit: q.editable_after_submit !== false,
      display_order: i,
    }));
  }

  /* E-mails */
  if (eChanged('reminders')) reg.reminders = e.reminders;
  if (eChanged('remindersOn')) settings.no_reminders = !e.remindersOn;
  if (eChanged('replayUrl')) reg.replay_url = e.replayUrl.trim();
  // The public page shows the replay only when asked; registrants always get it by e-mail.
  if (eChanged('replayUrl') || eChanged('replayPublic')) {
    if (e.replayPublic) event.replay_url = e.replayUrl.trim();
    else if (initial.emails.replayPublic) event.replay_url = '';
  }
  if (eChanged('notifyEmail')) reg.notify_email = e.notifyEmail.trim();
  if (eChanged('staffAlertMode')) reg.staff_alert_mode = e.staffAlertMode;
  if (eChanged('contactEmail')) settings.contact_email = e.contactEmail.trim();
  if (onsite) {
    if (eChanged('practicalInfo')) settings.practical_info = e.practicalInfo.trim();
    if (eChanged('intros')) {
      const intros: Record<string, string> = {};
      for (const k of INTRO_TEMPLATES) {
        const v = (e.intros[k] || '').trim();
        if (v) intros[k] = v.slice(0, INTRO_MAX);
      }
      settings.email_intros = intros;
    }
  }

  if (Object.keys(settings).length) reg.settings = settings;
  if (Object.keys(event).length) p.event = event;
  if (Object.keys(reg).length) p.registration = reg;
  return p;
}
