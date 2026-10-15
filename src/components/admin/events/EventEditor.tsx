import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Copy, ExternalLink, Loader2, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { EditDialog } from '@/components/home/dashboard/EditKit';
import { supabase } from '@/lib/supabase';
import { useRegistrationFlags } from '@/lib/flags';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
  AdminDetailHeader, AdminLoading, AdminSegmented, AdminStatusPill,
} from '../AdminUI';
import { BasicsTab } from './BasicsTab';
import { RegistrationTab } from './RegistrationTab';
import { TicketsTab } from './TicketsTab';
import { QuestionsTab } from './QuestionsTab';
import { EmailsTab } from './EmailsTab';
import { ModulesTab } from './ModulesTab';
import { EventRegistrationsPanel } from './EventRegistrationsPanel';
import { EDITOR_BTN, EDITOR_BTN_PRIMARY, Field, INPUT, Note } from './editorUi';
import {
  EditorError, RESERVED_SLUGS, SLUG_RE, cloneEvent, editorErrorText, findGlEvent, formatInZone, isoToWall, loadAnswerKeys,
  loadEvent, loadTicketUsage, readEventStamp, saveEvent, saveSectors, slugify, useRegistrationCaps, wallToIso,
  type EventKind, type LoadedEvent,
} from './eventAdmin';
import {
  buildPayload, checkForm, defaultAlertMode, dirtySections, dirtyTabs, formFromLoaded, newForm,
  type EditorForm, type EditorTab, type FormIssue, type FormSection,
} from './editorModel';

/**
 * Below md the admin area has its own sticky bar (AdminPage, top-16, 48 px tall): the
 * editor's sticky header sits under it there, so its back link stays visible.
 */
const HEADER_TOP = 'top-28 md:top-16';

/**
 * The event editor of the registration core (spec §8.2): /admin/events/new and
 * /admin/events/:id for events that register through gl_* (engine core_v2).
 * Webinars in full. On-site events (Phase 3) in full only in the ON-SITE EDITOR:
 * flag onsite_v2 on, or a hidden test event (the registration function serves hidden
 * events whatever the flags), or ?editor=new (staff tests, as for a new event). Without
 * it an on-site event keeps today's editor: Basics and the list of people registered,
 * no decisions. Decisions, invitations and every e-mail to registrants need more: onsite_v2
 * on, or the event SAVED as a hidden test (?editor=new alone opens only the settings).
 * Tabs of the on-site editor: Basics (venue, M3 team), How to register
 * (account e-mail timing), Participation types, Questions, E-mails (intros, preview,
 * test), People registered (decisions, invitations, accounts), Modules (After WYS).
 *
 * One Save button sends ONE admin_save_event call with the tabs that changed. Sectors
 * stay in event_sectors (written after the call, as in the old editor).
 */
export function EventEditor({ routeId, initialKind, forced = false }: { routeId: string; initialKind: EventKind; forced?: boolean }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const isNew = routeId === 'new';
  const { flags } = useRegistrationFlags();

  const [loaded, setLoaded] = useState<LoadedEvent | null>(null);
  const [loading, setLoading] = useState(!isNew);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [initial, setInitial] = useState<EditorForm>(() => newForm(initialKind));
  const [form, setForm] = useState<EditorForm>(() => newForm(initialKind));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showIssues, setShowIssues] = useState(false);
  const [notInstalled, setNotInstalled] = useState(false);
  const [regCount, setRegCount] = useState(0);
  const [confirmedCount, setConfirmedCount] = useState(0);
  const [dup, setDup] = useState<{ title: string; slug: string; start: string; error: string | null; busy: boolean } | null>(null);

  const kind = form.basics.kind;
  // A test event of the contract scripts (canary): no catalogue row. Saving any tab would
  // create one (and its date would then override the runbook's settings.starts_at), so
  // this page only lists its registrations.
  const isCanary = !isNew && !!loaded && !loaded.gl.legacy_event_id;
  // The on-site editor (see the header). A failed read of the flags counts as off (today's editor).
  const onsiteEditor = kind === 'onsite' && (flags.onsite_v2 || forced || loaded?.gl.hidden === true);
  // Decisions, invitations and e-mails to people: only where the registration function
  // serves the new pages (onsite_v2 on, or a SAVED hidden test). ?editor=new alone opens
  // the settings, never e-mails real people links to a page the live site lacks.
  const onsiteLive = kind === 'onsite' && (flags.onsite_v2 || loaded?.gl.hidden === true);
  // What the deployed registration function can do (invitations, test e-mails, intros).
  const caps = useRegistrationCaps(onsiteEditor);
  const fullEditor = kind === 'webinar' || onsiteEditor;
  const tabParam = params.get('tab') as EditorTab | null;
  const tabs = useMemo<EditorTab[]>(() => {
    if (isCanary) return ['registrations'];
    const list: EditorTab[] = kind === 'webinar'
      ? ['basics', 'registration', 'questions', 'emails']
      : onsiteEditor ? ['basics', 'registration', 'tickets', 'questions', 'emails'] : ['basics'];
    if (!isNew) list.push('registrations');
    if (onsiteEditor) list.push('modules');
    return list;
  }, [kind, isNew, isCanary, onsiteEditor]);
  const tab: EditorTab = tabParam && tabs.includes(tabParam) ? tabParam : tabs[0];
  const setTab = (next: EditorTab) => {
    const p = new URLSearchParams(params);
    if (next === tabs[0]) p.delete('tab'); else p.set('tab', next);
    setParams(p, { replace: true });
  };

  const applyLoaded = useCallback((l: LoadedEvent) => {
    const f = formFromLoaded(l);
    setLoaded(l);
    setInitial(f);
    setForm(f);
  }, []);

  // Existing event: the gl_event behind the catalogue id, then its rows.
  useEffect(() => {
    if (isNew) return;
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const gl = await findGlEvent(routeId);
        if (!alive) return;
        if (!gl || gl.engine !== 'core_v2') {
          setLoadError(t('adminEvents.notFound', 'This event does not use the new registration. Open it from the events list.'));
        } else {
          const l = await loadEvent(gl);
          if (!alive) return;
          applyLoaded(l);
          const [{ count }, { count: confirmed }] = await Promise.all([
            supabase.from('gl_guest').select('id', { count: 'exact', head: true }).eq('event_id', gl.id),
            // On-site (Modules tab, door check-in hint): how many are confirmed.
            gl.kind === 'onsite'
              ? supabase.from('gl_guest').select('id', { count: 'exact', head: true }).eq('event_id', gl.id).eq('status', 'confirmed')
              : Promise.resolve({ count: 0 }),
          ]);
          if (alive) {
            setRegCount(count ?? 0);
            setConfirmedCount(confirmed ?? 0);
          }
        }
      } catch (e) {
        if (alive) setLoadError(editorErrorText(e, t));
      }
      if (alive) setLoading(false);
    })();
    return () => { alive = false; };
  }, [isNew, routeId, applyLoaded, t]);

  // New event: is the registration core installed on the database yet?
  useEffect(() => {
    if (!isNew) return;
    let alive = true;
    supabase.from('gl_question').select('id', { count: 'exact', head: true }).limit(1)
      .then(({ error }) => { if (alive && error) setNotInstalled(true); });
    return () => { alive = false; };
  }, [isNew]);

  // Questions tab: every answer key ever stored, so a new question never reuses the
  // internal name of a removed one (read once, only when people have registered).
  const [answerKeys, setAnswerKeys] = useState<string[] | null>(null);
  const glIdForKeys = loaded?.gl.id ?? null;
  useEffect(() => {
    if (tab !== 'questions' || !glIdForKeys || regCount === 0 || answerKeys) return;
    let alive = true;
    loadAnswerKeys(glIdForKeys)
      .then((keys) => { if (alive) setAnswerKeys(keys); })
      .catch(() => { /* the saved questions' keys still protect the usual case */ });
    return () => { alive = false; };
  }, [tab, glIdForKeys, regCount, answerKeys]);

  // Participation types tab: how many registrations use each type (a used type is only
  // switched off when removed). Read once, only when people have registered.
  const [ticketUsage, setTicketUsage] = useState<Record<string, number> | null>(null);
  useEffect(() => {
    if (tab !== 'tickets' || !glIdForKeys || regCount === 0 || ticketUsage) return;
    let alive = true;
    loadTicketUsage(glIdForKeys)
      .then((u) => { if (alive) setTicketUsage(u); })
      .catch(() => { /* the saved keys still protect the usual case; the database deactivates a used type */ });
    return () => { alive = false; };
  }, [tab, glIdForKeys, regCount, ticketUsage]);

  const dirty = useMemo(() => dirtySections(form, initial), [form, initial]);
  const dirtyTabList = useMemo(() => dirtyTabs(form, initial), [form, initial]);
  const hasChanges = isNew || dirty.length > 0;
  const unsaved = isNew ? !!form.basics.title.trim() : dirty.length > 0;
  // Saving "Invitation only" with requests off needs invitations on the server (until then
  // nobody could register); an event already saved that way keeps saving.
  const checkOpts = useMemo(() => ({
    invitesReady: caps.invite,
    savedInviteOnly: initial.registration.mode === 'invitation' && !initial.registration.publicRequests,
  }), [caps.invite, initial.registration.mode, initial.registration.publicRequests]);
  const issues: FormIssue[] = useMemo(() => (showIssues ? checkForm(form, t, fullEditor, checkOpts) : []), [showIssues, form, t, fullEditor, checkOpts]);

  // Leaving the page with unsaved changes: the browser asks first.
  useEffect(() => {
    if (!unsaved) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [unsaved]);

  // And inside the site (sidebar, back link, any other link): ask before leaving. Runs in
  // the capture phase, before the router's own click handler.
  useEffect(() => {
    if (!unsaved) return;
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target instanceof Element ? e.target.closest('a[href]') : null) as HTMLAnchorElement | null;
      if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return;
      let url: URL;
      try { url = new URL(a.href, window.location.href); } catch { return; }
      if (url.origin !== window.location.origin || url.pathname === window.location.pathname) return;
      if (!window.confirm(t('adminEvents.leaveConfirm', 'You have changes that are not saved. Leave this page anyway?'))) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [unsaved, t]);

  const kindOn = (k: EventKind) => (k === 'webinar' ? flags.webinar_v2 : flags.onsite_v2);

  const setSection = <S extends FormSection>(s: S, value: EditorForm[S]) => {
    setSaveError(null);
    if (s === 'basics' && isNew) {
      const nextKind = (value as EditorForm['basics']).kind;
      // The other type's switch is off: its events are still made in the current editor.
      if (nextKind !== form.basics.kind && !forced && !kindOn(nextKind)) {
        navigate(`/admin/events/new?type=${nextKind === 'onsite' ? 'on_site' : 'webinar'}`, { replace: true });
        return;
      }
    }
    setForm((f) => {
      // A new event that changes type starts from that type's registration defaults.
      if (s === 'basics' && isNew && (value as EditorForm['basics']).kind !== f.basics.kind) {
        const nextBasics = { ...(value as EditorForm['basics']) };
        const fresh = newForm(nextBasics.kind);
        // A new event reaches this editor with its switch on or with ?editor=new, so the
        // on-site editor is there: a hidden on-site test can be decided on. (Kept as a
        // guard should that ever change.)
        if (nextBasics.kind === 'onsite' && nextBasics.visibility === 'hidden' && !(forced || flags.onsite_v2)) nextBasics.visibility = 'draft';
        return { ...fresh, basics: nextBasics };
      }
      // A new event: the staff alert follows the registration mode (one summary a day for
      // open registration, one e-mail per request otherwise), unless chosen by hand.
      if (s === 'registration' && isNew) {
        const nextMode = (value as EditorForm['registration']).mode;
        if (nextMode !== f.registration.mode && f.emails.staffAlertMode === defaultAlertMode(f.registration.mode)) {
          return { ...f, registration: value as EditorForm['registration'], emails: { ...f.emails, staffAlertMode: defaultAlertMode(nextMode) } };
        }
      }
      return { ...f, [s]: value };
    });
  };

  const glId = loaded?.gl.id ?? null;
  const eventId = loaded?.gl.legacy_event_id ?? null;
  const wasPublished = initial.basics.visibility === 'published';
  const canPublish = kindOn(kind) || wasPublished;
  /** ?editor=new to keep on the next page (on-site editor opened that way while onsite_v2 is off). */
  const keepOnsiteEditor = kind === 'onsite' && forced && !flags.onsite_v2 ? '?editor=new' : '';

  const save = async () => {
    if (isCanary) return;
    const found = checkForm(form, t, fullEditor, checkOpts);
    if (found.length) {
      setShowIssues(true);
      const first = found[0].tab;
      if (tabs.includes(first)) setTab(first);
      setSaveError(t('adminEvents.fixFirst', 'Some fields need a look before saving. They are marked in red.'));
      return;
    }
    setShowIssues(false);
    const payload = buildPayload(form, initial, glId);
    const sectorsChanged = JSON.stringify(form.basics.sectorIds) !== JSON.stringify(initial.basics.sectorIds);
    const onlyId = Object.keys(payload).every((k) => k === 'id');
    if (!isNew && onlyId && !sectorsChanged) {
      toast({ title: t('adminEvents.nothing', 'Nothing to save') });
      return;
    }
    setSaving(true);
    setSaveError(null);
    // Saved elsewhere since this page loaded (someone else, or this event open in another
    // tab)? Say so first. Only the fields changed here are sent either way.
    if (!isNew && glId && loaded && !onlyId) {
      const stamp = await readEventStamp(glId, eventId).catch(() => null);
      const loadedPublished = loaded.catalogue ? !!loaded.catalogue.published : null;
      const savedElsewhere = !!stamp && (
        (!!stamp.updatedAt && !!loaded.gl.updated_at && stamp.updatedAt !== loaded.gl.updated_at)
        || (stamp.published !== null && loadedPublished !== null && stamp.published !== loadedPublished)
      );
      if (savedElsewhere && !window.confirm(t(
        'adminEvents.staleConfirm',
        'This event was saved by someone else (or in another tab) after you opened this page. Save your changes anyway? Only the fields you changed are replaced. To see their version first, press Cancel and reload the page.',
      ))) {
        setSaving(false);
        return;
      }
    }
    let res: { gl_event_id: string; event_id: string; slug: string };
    try {
      res = onlyId && glId && eventId ? { gl_event_id: glId, event_id: eventId, slug: form.basics.slug } : await saveEvent(payload);
    } catch (e) {
      setSaveError(editorErrorText(e, t));
      if (e instanceof EditorError && /^slug_|^title_|publish_needs_flag/.test(e.code)) setTab('basics');
      if (e instanceof EditorError && /ticket/.test(e.code) && tabs.includes('tickets')) setTab('tickets');
      if (e instanceof EditorError && e.code === 'not_installed') setNotInstalled(true);
      setSaving(false);
      return;
    }
    if (sectorsChanged) {
      try {
        await saveSectors(res.event_id, form.basics.sectorIds);
      } catch {
        toast({ title: t('adminEvents.sectorsFailed', 'Saved, but the sectors could not be updated'), description: t('adminEvents.tryAgain', 'Try again in a moment.'), variant: 'destructive' });
      }
    }
    if (isNew) {
      setSaving(false);
      toast({
        title: t('adminEvents.created', 'Event created'),
        description: form.basics.visibility === 'published' ? undefined : t('adminEvents.createdDraft', 'It stays invisible to the public until you publish it.'),
      });
      // An on-site event made with ?editor=new (switch off) stays in the on-site editor.
      navigate(`/admin/events/${res.event_id}${kind === 'webinar' ? '?tab=registration' : keepOnsiteEditor}`, { replace: true });
      return;
    }
    // Saved. Re-read what the database now holds (it normalises some values).
    try {
      const gl = await findGlEvent(res.event_id);
      if (gl) applyLoaded(await loadEvent(gl));
      toast({ title: t('adminEvents.saved', 'Changes saved') });
    } catch {
      setInitial(form);
      toast({ title: t('adminEvents.saved', 'Changes saved'), description: t('adminEvents.savedReload', 'Reload the page to see the latest version.') });
    }
    setSaving(false);
  };

  /** "Attendance is complete" (Registrations tab): read by registration-cron for the absentee e-mail. */
  const setAttendanceRecorded = async (value: boolean) => {
    if (!glId || isCanary) return;
    await saveEvent({ id: glId, registration: { settings: { attendance_recorded: value } } });
    // That save stamps updated_at: keep it, so the next Save does not think someone else saved.
    const stamp = await readEventStamp(glId, null).catch(() => null);
    setLoaded((l) => (l ? {
      ...l,
      gl: { ...l.gl, settings: { ...(l.gl.settings || {}), attendance_recorded: value }, updated_at: stamp?.updatedAt ?? l.gl.updated_at },
    } : l));
  };

  /* ---------------------------------------------------------- duplicate */

  const openDuplicate = () => {
    // The copy is made from the SAVED event: propose its saved title, address and date.
    const title = `${initial.basics.title} (${t('adminEvents.dup.copyWord', 'copy')})`;
    setDup({ title, slug: slugify(`${initial.basics.slug}-copy`), start: initial.basics.start, error: null, busy: false });
  };
  const runDuplicate = async () => {
    if (!dup || !glId || !loaded) return;
    const slug = slugify(dup.slug);
    if (!dup.title.trim()) { setDup({ ...dup, error: t('adminEvents.dup.needTitle', 'Give the copy a title.') }); return; }
    if (!slug || !SLUG_RE.test(slug) || RESERVED_SLUGS.includes(slug)) {
      setDup({ ...dup, error: t('adminEvents.dup.needSlug', 'Give the copy its own web address (letters, numbers and dashes).') });
      return;
    }
    const tz = initial.basics.timezone;
    const event: Record<string, unknown> = { title: dup.title.trim() };
    if (dup.start) {
      const startIso = wallToIso(dup.start, tz);
      const oldStart = initial.basics.start ? wallToIso(initial.basics.start, tz) : null;
      const oldEnd = initial.basics.end ? wallToIso(initial.basics.end, tz) : null;
      event.date_time = startIso;
      // Same length as the original.
      event.end_date_time = startIso && oldStart && oldEnd
        ? new Date(new Date(startIso).getTime() + (new Date(oldEnd).getTime() - new Date(oldStart).getTime())).toISOString()
        : null;
    }
    const registration: Record<string, unknown> = { slug };
    // The copy's attendance is not recorded yet, whatever the original's state (the clone
    // copies the settings, and `settings` given here replaces them as a whole).
    if (loaded.gl.kind === 'webinar') registration.settings = { ...(loaded.gl.settings || {}), attendance_recorded: false };
    setDup({ ...dup, busy: true, error: null });
    let res: { gl_event_id: string; event_id: string; slug: string };
    try {
      res = await cloneEvent(glId, { event, registration });
    } catch (e) {
      setDup((d) => (d ? { ...d, busy: false, error: editorErrorText(e, t) } : d));
      return;
    }
    // The clone copies the event, its settings and questions, not its sectors (event_sectors).
    let sectorsFailed = false;
    if (initial.basics.sectorIds.length) {
      try {
        await saveSectors(res.event_id, initial.basics.sectorIds);
      } catch {
        sectorsFailed = true;
      }
    }
    setDup(null);
    if (sectorsFailed) {
      toast({
        title: t('adminEvents.dup.sectorsFailed', 'Copy created, but its sectors could not be copied'),
        description: t('adminEvents.dup.sectorsFailedBody', 'Choose them again in Basics of the copy, then save.'),
        variant: 'destructive',
      });
    } else {
      toast({ title: t('adminEvents.dup.done', 'Copy created as a draft'), description: t('adminEvents.dup.doneBody', 'Check the dates and the online link before publishing it.') });
    }
    navigate(`/admin/events/${res.event_id}${keepOnsiteEditor}`);
  };

  /* ---------------------------------------------------------- render */

  if (loading) return <AdminLoading />;
  if (loadError) {
    return (
      <div className="mx-auto max-w-3xl">
        <AdminDetailHeader className={HEADER_TOP} back={{ to: '/admin/events', label: t('adminEvents.back', 'Events') }} title={t('adminEvents.editTitle', 'Event')} />
        <Note tone="danger"><span role="alert">{loadError}</span></Note>
        <Button type="button" variant="outline" size="sm" className={cn(EDITOR_BTN, 'mt-4')} onClick={() => window.location.reload()}>
          {t('adminEvents.tryAgainBtn', 'Try again')}
        </Button>
      </div>
    );
  }

  const b = form.basics;
  const tabWords: Record<EditorTab, string> = {
    basics: t('adminEvents.tab.basics', 'Basics'),
    registration: t('adminEvents.tab.howToRegister', 'How to register'),
    tickets: t('adminEvents.tab.tickets', 'Participation types'),
    questions: t('adminEvents.tab.questions', 'Questions'),
    emails: t('adminEvents.tab.emails', 'E-mails'),
    registrations: regCount
      ? t('adminEvents.tab.peopleN', 'People registered ({{n}})', { n: regCount })
      : t('adminEvents.tab.people', 'People registered'),
    modules: t('adminEvents.tab.modules', 'Modules'),
  };
  const tabHasIssue = (x: EditorTab) => issues.some((i) => i.tab === x);
  const startIso = b.start ? wallToIso(b.start, b.timezone) : null;
  const savedStartIso = initial.basics.start ? wallToIso(initial.basics.start, initial.basics.timezone) : null;
  const visibilityPill = b.visibility === 'published'
    ? <AdminStatusPill tone="success">{t('adminEvents.basics.published', 'Published')}</AdminStatusPill>
    : b.visibility === 'hidden'
      ? <AdminStatusPill>{t('adminEvents.basics.hidden', 'Hidden test')}</AdminStatusPill>
      : <AdminStatusPill tone="warning">{t('adminEvents.basics.draft', 'Draft')}</AdminStatusPill>;
  const showSave = !isCanary && tab !== 'registrations' && tab !== 'modules';
  // gl_event.settings.attendance_recorded as stored: true, false, or absent (see editorModel).
  const attendanceSetting = (loaded?.gl.settings || {}).attendance_recorded;
  const savedQuestionKeys = loaded ? loaded.questions.map((q) => q.key) : [];
  const canDuplicate = !isNew && !!glId && !isCanary;
  const canView = !isNew && !!eventId;

  const saveButton = (
    <Button type="button" variant="secondary" size="sm" className={EDITOR_BTN_PRIMARY} onClick={save} disabled={saving || !hasChanges}>
      {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="mr-1.5 h-4 w-4" aria-hidden="true" />}
      {isNew ? t('adminEvents.create', 'Create the event') : t('adminEvents.save', 'Save changes')}
    </Button>
  );
  const viewButton = (extra?: string) => (
    <Button asChild variant="outline" size="sm" className={cn(EDITOR_BTN, extra)}>
      <a href={`/events/${eventId}`} target="_blank" rel="noopener noreferrer">
        <ExternalLink className="mr-1.5 h-4 w-4" aria-hidden="true" />
        {t('adminEvents.view', 'View page')}
      </a>
    </Button>
  );
  const duplicateButton = (extra?: string) => (
    <Button type="button" variant="outline" size="sm" className={cn(EDITOR_BTN, extra)} onClick={openDuplicate}>
      <Copy className="mr-1.5 h-4 w-4" aria-hidden="true" />
      {t('adminEvents.duplicate', 'Duplicate')}
    </Button>
  );

  return (
    <div className="mx-auto max-w-5xl">
      <AdminDetailHeader
        className={HEADER_TOP}
        back={{ to: `/admin/events?type=${kind === 'webinar' ? 'webinar' : 'on_site'}`, label: t('adminEvents.back', 'Events') }}
        title={isNew
          ? (kind === 'webinar' ? t('adminEvents.newWebinar', 'New webinar') : t('adminEvents.newOnsite', 'New on-site event'))
          : (
            // Phones: one line, so the sticky header keeps the form in view.
            <span className="line-clamp-1 sm:line-clamp-none" title={b.title}>{b.title || t('adminEvents.untitled', 'Untitled event')}</span>
          )}
        badges={(
          <>
            <AdminStatusPill tone={kind === 'onsite' ? 'navy' : 'neutral'}>{kind === 'onsite' ? t('adminEvents.basics.onsite', 'On-site event') : t('adminEvents.basics.webinar', 'Webinar')}</AdminStatusPill>
            {!isNew && visibilityPill}
            {!isNew && dirty.length > 0 && <AdminStatusPill tone="warning">{t('adminEvents.unsaved', 'Not saved yet')}</AdminStatusPill>}
          </>
        )}
        subtitle={startIso ? formatInZone(startIso, b.timezone, !b.isFullDay) : t('adminEvents.noDate', 'Date to be set')}
        actions={(canView || canDuplicate || showSave) ? (
          <>
            {/* Phones: only Save stays in the sticky header; the others sit at the bottom, with words. */}
            {canView && viewButton('hidden sm:inline-flex')}
            {canDuplicate && duplicateButton('hidden sm:inline-flex')}
            {showSave && saveButton}
          </>
        ) : undefined}
      />

      <div className="space-y-5">
        {notInstalled && (
          <Note tone="warning">
            {t('adminEvents.notInstalled', 'The new registration system is not installed on the database yet. You can look around, but saving will not work.')}
          </Note>
        )}
        {saveError && <Note tone="danger"><span role="alert">{saveError}</span></Note>}

        {/* Phones: one plain list of the parts. Wider screens: the segmented bar. */}
        {tabs.length > 1 && (
          <div className="sm:hidden">
            <Select value={tab} onValueChange={(x) => setTab(x as EditorTab)}>
              <SelectTrigger className={INPUT} aria-label={t('adminEvents.tabs', 'Parts of the event')}><SelectValue /></SelectTrigger>
              <SelectContent>
                {tabs.map((x) => (
                  <SelectItem key={x} value={x}>
                    {tabWords[x]}{tabHasIssue(x) ? ` (${t('adminEvents.tabIssue', 'needs a look')})` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {tabs.length > 1 && (
          <div className="-mx-1 hidden overflow-x-auto px-1 pb-1 sm:block">
            <AdminSegmented<EditorTab>
              label={t('adminEvents.tabs', 'Parts of the event')}
              value={tab}
              onChange={setTab}
              options={tabs.map((x) => ({
                value: x,
                label: (
                  <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                    {tabWords[x]}
                    {(tabHasIssue(x) || (dirtyTabList.includes(x) && !isNew)) && (
                      <span
                        className={cn('h-1.5 w-1.5 rounded-full', tabHasIssue(x) ? 'bg-red-600' : 'bg-gold')}
                        aria-label={tabHasIssue(x) ? t('adminEvents.tabIssue', 'needs a look') : t('adminEvents.tabDirty', 'changed')}
                      />
                    )}
                  </span>
                ),
              }))}
            />
          </div>
        )}

        {isCanary && (
          <Note>
            {t('adminEvents.canary', 'This is a test event of the set-up scripts, without an event page. Change it with the runbook, not here: saving from this page would create an event page for it. Its registrations are listed below.')}
          </Note>
        )}
        {kind === 'onsite' && tab === 'basics' && !onsiteEditor && (
          <Note>
            {t('adminEvents.onsiteLater', 'For on-site events, this page sets the basics. Registration settings, participation types, questions and decisions arrive with the on-site editor, in a later update. Meanwhile people register with their name, e-mail and the usual fields, and you can see them in People registered.')}
          </Note>
        )}
        {kind === 'onsite' && onsiteEditor && !flags.onsite_v2 && !isCanary && (
          <Note tone="warning">
            {b.visibility === 'hidden' || initial.basics.visibility === 'hidden'
              ? t('adminEvents.onsiteTest', 'On-site registration is not live on the site yet. This is a hidden test event: registrations and decisions work by its direct link only, with test addresses.')
              : t('adminEvents.onsitePreview', 'On-site registration is not live on the site yet. You can prepare this event as a draft; to try registrations and decisions, save it as a hidden test.')}
          </Note>
        )}

        {tab === 'basics' && (
          <BasicsTab
            value={b}
            onChange={(v) => setSection('basics', v)}
            issues={issues}
            isNew={isNew}
            slugLocked={!isNew && (wasPublished || regCount > 0)}
            slugLockedByRegistrations={!isNew && !wasPublished && regCount > 0}
            canPublish={canPublish}
            eventId={eventId}
            savedVisibility={isNew ? null : initial.basics.visibility}
            kindOpensOldEditor={isNew && !forced ? { webinar: !flags.webinar_v2, onsite: !flags.onsite_v2 } : null}
            onsiteEditor={onsiteEditor}
            staff={onsiteEditor ? { value: form.emails, onChange: (v) => setSection('emails', v), mode: form.registration.mode } : undefined}
            hiddenTest={onsiteEditor ? {
              closed: !!form.registration.closesAt && (wallToIso(form.registration.closesAt, b.timezone) ?? '') <= new Date().toISOString(),
              // A hidden test takes registrations by its link until it closes (contract §9).
              onCloseNow: () => setSection('registration', { ...form.registration, closesAt: isoToWall(new Date().toISOString(), b.timezone) }),
            } : undefined}
          />
        )}
        {tab === 'registration' && (
          <RegistrationTab
            value={form.registration}
            onChange={(v) => setSection('registration', v)}
            issues={issues}
            timezone={b.timezone}
            eventStart={b.start}
            invitationAllowed={kind === 'onsite' || initial.registration.mode === 'invitation'}
            kind={kind}
            ticketCount={form.tickets.list.filter((x) => x.active).length}
            invitesReady={caps.invite}
          />
        )}
        {tab === 'tickets' && (
          <TicketsTab
            value={form.tickets}
            onChange={(v) => setSection('tickets', v)}
            issues={issues}
            usage={ticketUsage}
            savedKeys={loaded ? loaded.tickets.map((x) => x.key) : []}
            invitesReady={caps.invite}
          />
        )}
        {tab === 'questions' && (
          <QuestionsTab
            value={form.questions}
            onChange={(v) => setSection('questions', v)}
            issues={issues}
            kind={kind}
            hasRegistrations={regCount > 0}
            savedKeys={savedQuestionKeys}
            reservedKeys={[...savedQuestionKeys, ...(answerKeys ?? [])]}
            fields={form.registration.fields}
            tickets={kind === 'onsite' ? form.tickets.list : []}
            parts={kind === 'onsite' ? form.tickets.parts : []}
          />
        )}
        {tab === 'emails' && (
          <EmailsTab
            value={form.emails}
            onChange={(v) => setSection('emails', v)}
            issues={issues}
            kind={kind}
            mode={form.registration.mode}
            attendanceRecorded={attendanceSetting === true}
            onOpenRegistrations={isNew ? undefined : () => setTab('registrations')}
            glEventId={glId}
            caps={caps}
            preview={kind === 'onsite' ? {
              title: b.title,
              startIso,
              timezone: b.timezone,
              isFullDay: b.isFullDay,
              location: b.location,
              mode: form.registration.mode,
              practicalInfo: form.emails.practicalInfo,
              ticketLabel: form.tickets.list.find((x) => x.active)?.label || null,
            } : undefined}
          />
        )}
        {tab === 'modules' && (
          <ModulesTab slug={isNew ? null : loaded?.gl.slug ?? null} hasConfirmed={confirmedCount > 0} />
        )}
        {tab === 'registrations' && glId && loaded && (
          <EventRegistrationsPanel
            glEventId={glId}
            kind={kind}
            capacity={loaded.gl.capacity}
            slug={loaded.gl.slug}
            timezone={initial.basics.timezone}
            startIso={savedStartIso}
            questions={loaded.questions}
            onCount={setRegCount}
            attendanceSetting={attendanceSetting}
            onAttendanceRecorded={isCanary ? undefined : setAttendanceRecorded}
            hasReplay={!!(loaded.gl.replay_url || loaded.catalogue?.replay_url)}
            mode={loaded.gl.registration_mode ?? (kind === 'webinar' ? 'instant' : 'review')}
            waitlist={!!loaded.gl.waitlist}
            onsiteEditor={onsiteLive}
            onsiteNotLive={onsiteEditor && !onsiteLive}
            hiddenTest={loaded.gl.hidden === true}
            caps={caps}
            onConfirmedCount={setConfirmedCount}
            tickets={loaded.tickets}
            accountTiming={loaded.gl.account_email_timing === 'after_event' ? 'after_event' : 'with_confirmation'}
            publicRequests={loaded.gl.public_requests !== false}
          />
        )}

        {(showSave || canView || canDuplicate) && (
          <div className={cn('flex flex-col-reverse gap-3 border-t border-rule pt-5 sm:flex-row sm:items-center sm:justify-end', !showSave && 'sm:hidden')}>
            {(canView || canDuplicate) && (
              <div className="flex flex-wrap gap-2 sm:hidden">
                {canView && viewButton()}
                {canDuplicate && duplicateButton()}
              </div>
            )}
            {showSave && !isNew && dirty.length > 0 && (
              <Button type="button" variant="outline" size="sm" className={EDITOR_BTN} disabled={saving} onClick={() => { setForm(initial); setShowIssues(false); setSaveError(null); }}>
                {t('adminEvents.discard', 'Undo my changes')}
              </Button>
            )}
            {showSave && saveButton}
          </div>
        )}
      </div>

      <EditDialog
        open={!!dup}
        onOpenChange={(o) => { if (!o) setDup(null); }}
        title={t('adminEvents.dup.title', 'Duplicate this event')}
        description={dirty.length
          ? t('adminEvents.dup.bodyDirty', 'The copy takes the saved version: changes not saved yet are not copied. Registrations are never copied.')
          : kind === 'onsite'
            ? t('adminEvents.dup.bodyOnsite', 'The copy keeps the settings, participation types, questions and e-mails, as a draft. Registrations are not copied.')
            : t('adminEvents.dup.body', 'The copy keeps the settings, questions and e-mails, as a draft. Registrations, the online link and the replay are not copied.')}
        onSave={runDuplicate}
        saveLabel={t('adminEvents.dup.go', 'Create the copy')}
        saving={!!dup?.busy}
        error={dup?.error}
      >
        {dup && (
          <div className="space-y-4">
            <Field label={t('adminEvents.basics.title', 'Title')} htmlFor="dup-title">
              <Input id="dup-title" value={dup.title} onChange={(e) => setDup({ ...dup, title: e.target.value, slug: slugify(e.target.value) })} className={INPUT} maxLength={200} />
            </Field>
            <Field label={t('adminEvents.basics.slug', 'Web address')} htmlFor="dup-slug" hint="/register/…">
              <Input id="dup-slug" value={dup.slug} onChange={(e) => setDup({ ...dup, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 60) })} className={INPUT} autoCapitalize="none" spellCheck={false} />
            </Field>
            <Field
              label={initial.basics.isFullDay ? t('adminEvents.basics.day', 'Day') : t('adminEvents.basics.start', 'Starts')}
              htmlFor="dup-start"
              hint={t('adminEvents.dup.startHint', 'In the same time zone as this event. You can change it later.')}
            >
              <Input
                id="dup-start"
                type={initial.basics.isFullDay ? 'date' : 'datetime-local'}
                value={initial.basics.isFullDay ? dup.start.slice(0, 10) : dup.start}
                onChange={(e) => setDup({ ...dup, start: e.target.value })}
                className={INPUT}
              />
            </Field>
          </div>
        )}
      </EditDialog>
    </div>
  );
}
