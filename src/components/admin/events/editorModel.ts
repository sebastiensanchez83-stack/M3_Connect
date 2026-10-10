import {
  DEFAULT_TIMEZONE, RESERVED_SLUGS, SLUG_RE, STANDARD_FIELDS, emailList, isEmail, isHttpsUrl, isoToWall,
  wallToIso, type EventKind, type FieldRule, type LoadedEvent, type QuestionRow, type RegistrationMode,
  type StandardField,
} from './eventAdmin';

/**
 * The editor's form, tab by tab, and how it becomes ONE admin_save_event payload.
 * Only the tabs that changed are sent (a key left out keeps its stored value), so two
 * people working on different tabs do not overwrite each other.
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
  followupNote: string;
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

/** A webinar without an account asks name, e-mail and (optionally) company (Victor, 6 Oct). */
const NEW_WEBINAR_FIELDS: Record<StandardField, FieldRule> = {
  company: 'optional', job_title: 'hidden', phone: 'hidden', country: 'hidden',
};

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

export function newForm(kind: EventKind): EditorForm {
  return {
    basics: {
      title: '', slug: '', kind, timezone: DEFAULT_TIMEZONE, start: '', end: '', isFullDay: false,
      location: '', meetingUrl: '', imageUrl: '', description: '', speakers: [], website: '',
      visibility: 'draft', sectorIds: [],
    },
    registration: {
      mode: kind === 'webinar' ? 'instant' : 'review',
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
      followupNote: '',
      notifyEmail: '',
      staffAlertMode: 'each',
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
      followupNote: str(s.followup_note),
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

export function checkForm(form: EditorForm, isNew: boolean): FormIssue[] {
  const out: FormIssue[] = [];
  const b = form.basics;
  const r = form.registration;
  const e = form.emails;
  const tz = b.timezone;
  const t = (wall: string) => (wall ? wallToIso(wall, tz) : null);

  if (!b.title.trim()) out.push({ tab: 'basics', field: 'title', message: 'Give the event a title.' });
  const slug = b.slug.trim();
  if (!slug) out.push({ tab: 'basics', field: 'slug', message: 'Give the event a web address.' });
  else if (!SLUG_RE.test(slug) || slug.length > 60) {
    out.push({ tab: 'basics', field: 'slug', message: 'Use lower-case letters, numbers and single dashes only (60 characters at most).' });
  } else if (RESERVED_SLUGS.includes(slug)) {
    out.push({ tab: 'basics', field: 'slug', message: 'This web address is reserved for another page. Choose another one.' });
  }
  if (b.start && !t(b.start)) out.push({ tab: 'basics', field: 'start', message: 'The start date is not complete.' });
  if (b.end && !b.isFullDay) {
    const s = t(b.start);
    const en = t(b.end);
    if (!en) out.push({ tab: 'basics', field: 'end', message: 'The end date is not complete.' });
    else if (s && en <= s) out.push({ tab: 'basics', field: 'end', message: 'The end must be after the start.' });
  }
  if (b.visibility === 'published' && !b.start) {
    out.push({ tab: 'basics', field: 'start', message: 'Set the date before publishing the event.' });
  }
  if (b.kind === 'webinar' && b.meetingUrl.trim() && !isHttpsUrl(b.meetingUrl)) {
    out.push({ tab: 'basics', field: 'meetingUrl', message: 'The join link must be a full address starting with https://' });
  }
  if (b.website.trim() && !/^https?:\/\/\S+\.\S+/i.test(b.website.trim())) {
    out.push({ tab: 'basics', field: 'website', message: 'The website must be a full address starting with https://' });
  }
  b.speakers.forEach((sp, i) => {
    if (!sp.name.trim() && sp.title.trim()) out.push({ tab: 'basics', field: `speaker${i}`, message: 'A speaker needs a name.' });
  });

  if (!isNew || b.kind === 'webinar') {
    if (r.capacity.trim() && (!wholeNumber(r.capacity) || Number(r.capacity) < 1)) {
      out.push({ tab: 'registration', field: 'capacity', message: 'Write a whole number of places, or leave it empty for no limit.' });
    }
    const opens = r.opensAt ? t(r.opensAt) : null;
    const closes = r.closesAt ? t(r.closesAt) : null;
    if (r.opensAt && !opens) out.push({ tab: 'registration', field: 'opensAt', message: 'This date is not complete.' });
    if (r.closesAt && !closes) out.push({ tab: 'registration', field: 'closesAt', message: 'This date is not complete.' });
    if (opens && closes && closes <= opens) {
      out.push({ tab: 'registration', field: 'closesAt', message: 'Registration must close after it opens.' });
    }
    if (r.editLocksAt && !t(r.editLocksAt)) out.push({ tab: 'registration', field: 'editLocksAt', message: 'This date is not complete.' });
    if (r.mode === 'instant' && b.kind !== 'webinar') {
      out.push({ tab: 'registration', field: 'mode', message: 'Open registration works for webinars only.' });
    }
  }

  form.questions.list.forEach((q, i) => {
    if (!q.label.trim()) out.push({ tab: 'questions', field: `q${i}`, message: `Question ${i + 1} needs a wording.` });
    if ((q.kind === 'select' || q.kind === 'multiselect') && (q.options?.length ?? 0) < 2) {
      out.push({ tab: 'questions', field: `q${i}`, message: `Question ${i + 1} needs at least two choices.` });
    }
  });

  if (e.remindersOn && e.reminders.length === 0) {
    out.push({ tab: 'emails', field: 'reminders', message: 'Tick at least one reminder, or switch reminders off.' });
  }
  if (e.replayUrl.trim() && !isHttpsUrl(e.replayUrl)) {
    out.push({ tab: 'emails', field: 'replayUrl', message: 'The replay link must be a full address starting with https://' });
  }
  // One address: the registration function sends staff alerts to exactly one recipient.
  if (e.notifyEmail.trim() && (emailList(e.notifyEmail).length !== 1 || !isEmail(e.notifyEmail))) {
    out.push({ tab: 'emails', field: 'notifyEmail', message: 'Write one e-mail address (a shared mailbox works best).' });
  }
  if (e.contactEmail.trim() && !isEmail(e.contactEmail)) {
    out.push({ tab: 'emails', field: 'contactEmail', message: 'This e-mail address is not valid.' });
  }
  return out;
}

/* ----------------------------------------------------------------- payload */

/**
 * The admin_save_event payload for the changed tabs (every tab when creating).
 * `glEventId` is omitted to create. Dates are read in the event's own time zone.
 */
export function buildPayload(form: EditorForm, initial: EditorForm, glEventId: string | null): Record<string, unknown> {
  const isNew = !glEventId;
  const dirty = new Set<FormSection>(isNew ? SECTIONS : dirtySections(form, initial));
  const tzChanged = form.basics.timezone !== initial.basics.timezone;
  const b = form.basics;
  const r = form.registration;
  const e = form.emails;
  const tz = b.timezone;
  const iso = (wall: string) => (wall ? wallToIso(wall, tz) : null);

  const event: Record<string, unknown> = {};
  const reg: Record<string, unknown> = {};
  const settings: Record<string, unknown> = {};
  const p: Record<string, unknown> = {};
  if (glEventId) p.id = glEventId;

  if (dirty.has('basics')) {
    event.title = b.title.trim();
    event.description = b.description.trim();
    event.date_time = iso(b.start);
    event.end_date_time = b.isFullDay ? null : iso(b.end);
    event.is_full_day = b.kind === 'onsite' ? b.isFullDay : false;
    event.location = b.kind === 'onsite' ? b.location.trim() : '';
    event.image_url = b.imageUrl;
    event.speakers = b.speakers
      .filter((sp) => sp.name.trim())
      .map((sp) => ({ name: sp.name.trim(), title: sp.title.trim() }));
    event.event_website_url = b.website.trim();
    event.published = b.visibility === 'published';
    reg.slug = b.slug.trim();
    reg.hidden = b.visibility === 'hidden';
    reg.meeting_url = b.kind === 'webinar' ? b.meetingUrl.trim() : '';
    settings.timezone = tz;
  }
  if (isNew) {
    reg.kind = b.kind;
    if (!event.language) event.language = 'EN';
  }

  // Registration dates are wall-clock times in the event's zone: re-sent when it changes.
  if (dirty.has('registration') || (tzChanged && !isNew)) {
    reg.opens_at = iso(r.opensAt);
    reg.closes_at = iso(r.closesAt);
    reg.edit_locks_at = iso(r.editLocksAt);
  }
  if (dirty.has('registration') && (!isNew || b.kind === 'webinar')) {
    reg.registration_mode = r.mode;
    reg.public_requests = r.publicRequests;
    reg.access = r.access;
    reg.capacity = r.capacity.trim() ? Number(r.capacity.trim()) : null;
    reg.waitlist = r.waitlist;
    reg.standard_fields = { ...r.fields };
  } else if (isNew) {
    reg.registration_mode = r.mode;
  }

  if (dirty.has('questions')) {
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

  if (dirty.has('emails')) {
    reg.reminders = e.reminders;
    reg.replay_url = e.replayUrl.trim();
    reg.notify_email = e.notifyEmail.trim();
    reg.staff_alert_mode = e.staffAlertMode;
    settings.no_reminders = !e.remindersOn;
    settings.followup_note = e.followupNote.trim();
    settings.contact_email = e.contactEmail.trim();
    // The public page shows the replay only when asked; registrants always get it by e-mail.
    if (e.replayPublic) event.replay_url = e.replayUrl.trim();
    else if (initial.emails.replayPublic) event.replay_url = '';
  }

  if (Object.keys(settings).length) reg.settings = settings;
  if (Object.keys(event).length) p.event = event;
  if (Object.keys(reg).length) p.registration = reg;
  return p;
}
