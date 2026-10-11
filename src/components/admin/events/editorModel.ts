import type { TFunction } from 'i18next';
import {
  DEFAULT_TIMEZONE, RESERVED_SLUGS, SLUG_RE, STANDARD_FIELDS, emailList, isEmail, isHttpsUrl, isoToWall,
  wallToIso, type EventKind, type FieldRule, type LoadedEvent, type QuestionRow, type RegistrationMode,
  type StandardField,
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
 */

export type EditorTab = 'basics' | 'registration' | 'questions' | 'emails' | 'registrations';
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
  location: string;
  meetingUrl: string;
  imageUrl: string;
  description: string;
  speakers: Speaker[];
  website: string;
  visibility: Visibility;
  sectorIds: string[];
}

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
}

export interface QuestionsForm { list: QuestionRow[] }

export interface EmailsForm {
  remindersOn: boolean;
  reminders: string[];
  replayUrl: string;
  replayPublic: boolean;
  notifyEmail: string;
  staffAlertMode: 'each' | 'digest';
  contactEmail: string;
}

export interface EditorForm {
  basics: BasicsForm;
  registration: RegistrationForm;
  questions: QuestionsForm;
  emails: EmailsForm;
}

export type FormSection = keyof EditorForm;
export const SECTIONS: FormSection[] = ['basics', 'registration', 'questions', 'emails'];

/** What the reminder e-mails send by default (registration-cron, when the list is empty). */
export const DEFAULT_REMINDERS: Record<EventKind, string[]> = { webinar: ['P7D', 'P1D', 'PT1H'], onsite: ['P7D'] };

/** Who at M3 hears about new registrations by default (also the reply-to fallback of the e-mails). */
export const M3_EVENTS_EMAIL = 'events@m3monaco.com';

/** A webinar without an account asks name, e-mail and (optionally) company (Victor, 6 Oct). */
const NEW_WEBINAR_FIELDS: Record<StandardField, FieldRule> = {
  company: 'optional', job_title: 'hidden', phone: 'hidden', country: 'hidden',
};

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/**
 * Staff alerts by default: open registration needs no decision, so one summary a day
 * (a popular webinar would otherwise send hundreds of alerts); when M3 accepts each
 * person, one e-mail per request.
 */
export function defaultAlertMode(mode: RegistrationMode): 'each' | 'digest' {
  return mode === 'instant' ? 'digest' : 'each';
}

export function newForm(kind: EventKind): EditorForm {
  const mode: RegistrationMode = kind === 'webinar' ? 'instant' : 'review';
  return {
    basics: {
      title: '', slug: '', kind, timezone: DEFAULT_TIMEZONE, start: '', end: '', isFullDay: false,
      location: '', meetingUrl: '', imageUrl: '', description: '', speakers: [], website: '',
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
      fields: kind === 'webinar' ? { ...NEW_WEBINAR_FIELDS } : { company: 'optional', job_title: 'optional', phone: 'optional', country: 'optional' },
    },
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
    },
  };
}

export function sectionDirty(a: EditorForm, b: EditorForm, section: FormSection): boolean {
  return JSON.stringify(a[section]) !== JSON.stringify(b[section]);
}

export function dirtySections(form: EditorForm, initial: EditorForm): FormSection[] {
  return SECTIONS.filter((s) => sectionDirty(form, initial, s));
}

/* ------------------------------------------------------------------ checks */

export interface FormIssue { tab: FormSection; field: string; message: string }

const wholeNumber = (v: string) => /^\d+$/.test(v.trim());

/**
 * What must be fixed before saving. Only the tabs the editor shows are checked: an
 * on-site event (Basics only until Phase 3) never gets an issue on a tab it cannot open.
 */
export function checkForm(form: EditorForm, t: TFunction): FormIssue[] {
  const out: FormIssue[] = [];
  const b = form.basics;
  const r = form.registration;
  const e = form.emails;
  const tz = b.timezone;
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

  // The other tabs exist for webinars only in Phase 1.
  if (b.kind !== 'webinar') return out;

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

  form.questions.list.forEach((q, i) => {
    if (!q.label.trim()) out.push({ tab: 'questions', field: `q${i}`, message: t('adminEvents.check.qWording', 'Question {{n}} needs a wording.', { n: i + 1 }) });
    if ((q.kind === 'select' || q.kind === 'multiselect') && (q.options?.length ?? 0) < 2) {
      out.push({ tab: 'questions', field: `q${i}`, message: t('adminEvents.check.qChoices', 'Question {{n}} needs at least two choices.', { n: i + 1 }) });
    }
  });

  if (e.remindersOn && e.reminders.length === 0) {
    out.push({ tab: 'emails', field: 'reminders', message: t('adminEvents.check.reminders', 'Tick at least one reminder, or switch reminders off.') });
  }
  if (e.replayUrl.trim() && !isHttpsUrl(e.replayUrl)) {
    out.push({ tab: 'emails', field: 'replayUrl', message: t('adminEvents.check.replayUrl', 'The replay link must be a full address starting with https://') });
  }
  // One address: the registration function sends staff alerts to exactly one recipient.
  if (e.notifyEmail.trim() && (emailList(e.notifyEmail).length !== 1 || !isEmail(e.notifyEmail))) {
    out.push({ tab: 'emails', field: 'notifyEmail', message: t('adminEvents.check.notifyOne', 'Write one e-mail address (a shared mailbox works best).') });
  } else if (!e.notifyEmail.trim() && r.mode !== 'instant') {
    // M3 accepts each person: without an alert, requests wait with nobody knowing.
    out.push({ tab: 'emails', field: 'notifyEmail', message: t('adminEvents.check.notifyNeeded', 'Choose who at M3 is told about new requests, or people will wait without anyone knowing.') });
  }
  if (e.contactEmail.trim() && !isEmail(e.contactEmail)) {
    out.push({ tab: 'emails', field: 'contactEmail', message: t('adminEvents.check.contactEmail', 'This e-mail address is not valid.') });
  }
  return out;
}

/* ----------------------------------------------------------------- payload */

/**
 * The admin_save_event payload: every field when creating, otherwise ONLY the fields
 * that differ from `initial` (the form as loaded or last saved). `glEventId` is omitted
 * to create. Dates are read in the event's own time zone, so a new zone re-sends them.
 */
export function buildPayload(form: EditorForm, initial: EditorForm, glEventId: string | null): Record<string, unknown> {
  const isNew = !glEventId;
  const b = form.basics;
  const r = form.registration;
  const e = form.emails;
  const tz = b.timezone;
  const tzChanged = b.timezone !== initial.basics.timezone;
  const iso = (wall: string) => (wall ? wallToIso(wall, tz) : null);
  const same = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y);
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

  /* How to register (webinars only in Phase 1; a new on-site event takes its mode) */
  if (rChanged('opensAt') || tzChanged) reg.opens_at = iso(r.opensAt);
  if (rChanged('closesAt') || tzChanged) reg.closes_at = iso(r.closesAt);
  if (rChanged('editLocksAt') || tzChanged) reg.edit_locks_at = iso(r.editLocksAt);
  if (rChanged('mode')) reg.registration_mode = r.mode;
  if (!isNew || b.kind === 'webinar') {
    if (rChanged('publicRequests')) reg.public_requests = r.publicRequests;
    if (rChanged('access')) reg.access = r.access;
    if (rChanged('capacity')) reg.capacity = r.capacity.trim() ? Number(r.capacity.trim()) : null;
    if (rChanged('waitlist')) reg.waitlist = r.waitlist;
    if (rChanged('fields')) reg.standard_fields = { ...r.fields };
  }

  /* Questions: the full list (upsert by key; a question left out is deleted) */
  if (isNew || !same(form.questions, initial.questions)) {
    p.questions = form.questions.list.map((q, i) => ({
      key: q.key,
      label: q.label.trim(),
      help: q.help?.trim() || null,
      kind: q.kind,
      options: q.kind === 'select' || q.kind === 'multiselect' ? (q.options || []) : null,
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

  if (Object.keys(settings).length) reg.settings = settings;
  if (Object.keys(event).length) p.event = event;
  if (Object.keys(reg).length) p.registration = reg;
  return p;
}
