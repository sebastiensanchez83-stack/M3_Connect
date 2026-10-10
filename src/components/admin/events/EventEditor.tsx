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
  ADMIN_BTN, ADMIN_BTN_PRIMARY, AdminDetailHeader, AdminLoading, AdminSegmented, AdminStatusPill,
} from '../AdminUI';
import { BasicsTab } from './BasicsTab';
import { RegistrationTab } from './RegistrationTab';
import { QuestionsTab } from './QuestionsTab';
import { EmailsTab } from './EmailsTab';
import { EventRegistrationsPanel } from './EventRegistrationsPanel';
import { Field, INPUT, Note } from './editorUi';
import {
  EditorError, RESERVED_SLUGS, SLUG_RE, cloneEvent, editorErrorText, findGlEvent, formatInZone, loadEvent,
  saveEvent, saveSectors, slugify, wallToIso, type EventKind, type LoadedEvent,
} from './eventAdmin';
import {
  buildPayload, checkForm, dirtySections, formFromLoaded, newForm,
  type EditorForm, type EditorTab, type FormIssue, type FormSection,
} from './editorModel';

/**
 * The event editor of the registration core (spec §8.2): /admin/events/new and
 * /admin/events/:id for events that register through gl_* (engine core_v2).
 * Webinars in full; on-site events get Basics and Registrations until Phase 3.
 *
 * One Save button sends ONE admin_save_event call with the tabs that changed. Sectors
 * stay in event_sectors (written after the call, as in the old editor).
 */
export function EventEditor({ routeId, initialKind }: { routeId: string; initialKind: EventKind }) {
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
  const [dup, setDup] = useState<{ title: string; slug: string; start: string; error: string | null; busy: boolean } | null>(null);

  const kind = form.basics.kind;
  const tabParam = params.get('tab') as EditorTab | null;
  const tabs = useMemo<EditorTab[]>(() => {
    const list: EditorTab[] = kind === 'webinar' ? ['basics', 'registration', 'questions', 'emails'] : ['basics'];
    if (!isNew) list.push('registrations');
    return list;
  }, [kind, isNew]);
  const tab: EditorTab = tabParam && tabs.includes(tabParam) ? tabParam : 'basics';
  const setTab = (next: EditorTab) => {
    const p = new URLSearchParams(params);
    if (next === 'basics') p.delete('tab'); else p.set('tab', next);
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
          const { count } = await supabase.from('gl_guest').select('id', { count: 'exact', head: true }).eq('event_id', gl.id);
          if (alive) setRegCount(count ?? 0);
        }
      } catch (e) {
        if (alive) setLoadError(editorErrorText(e));
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

  const dirty = useMemo(() => dirtySections(form, initial), [form, initial]);
  const hasChanges = isNew || dirty.length > 0;
  const issues: FormIssue[] = useMemo(() => (showIssues ? checkForm(form, isNew) : []), [showIssues, form, isNew]);

  // Leaving the page with unsaved changes: the browser asks first.
  useEffect(() => {
    if (isNew ? !form.basics.title : dirty.length === 0) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty.length, isNew, form.basics.title]);

  const setSection = <S extends FormSection>(s: S, value: EditorForm[S]) => {
    setSaveError(null);
    setForm((f) => {
      // A new event that changes type starts from that type's registration defaults.
      if (s === 'basics' && isNew && (value as EditorForm['basics']).kind !== f.basics.kind) {
        const fresh = newForm((value as EditorForm['basics']).kind);
        return { ...fresh, basics: { ...(value as EditorForm['basics']) } };
      }
      return { ...f, [s]: value };
    });
  };

  const glId = loaded?.gl.id ?? null;
  const eventId = loaded?.gl.legacy_event_id ?? null;
  const wasPublished = initial.basics.visibility === 'published';
  const canPublish = (kind === 'webinar' ? flags.webinar_v2 : flags.onsite_v2) || wasPublished;

  const save = async () => {
    const found = checkForm(form, isNew);
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
    try {
      const res = onlyId && glId && eventId ? { gl_event_id: glId, event_id: eventId, slug: form.basics.slug } : await saveEvent(payload);
      if (sectorsChanged) {
        try {
          await saveSectors(res.event_id, form.basics.sectorIds);
        } catch {
          toast({ title: t('adminEvents.sectorsFailed', 'Saved, but the sectors could not be updated'), description: t('adminEvents.tryAgain', 'Try again in a moment.'), variant: 'destructive' });
        }
      }
      if (isNew) {
        toast({
          title: t('adminEvents.created', 'Event created'),
          description: form.basics.visibility === 'published' ? undefined : t('adminEvents.createdDraft', 'It stays invisible to the public until you publish it.'),
        });
        navigate(`/admin/events/${res.event_id}${kind === 'webinar' ? '?tab=registration' : ''}`, { replace: true });
        return;
      }
      const gl = await findGlEvent(res.event_id);
      if (gl) applyLoaded(await loadEvent(gl));
      // A canary without a catalogue row gets one on its first save: follow the new id.
      if (routeId !== res.event_id) navigate(`/admin/events/${res.event_id}${tab === 'basics' ? '' : `?tab=${tab}`}`, { replace: true });
      toast({ title: t('adminEvents.saved', 'Changes saved') });
    } catch (e) {
      const msg = editorErrorText(e);
      setSaveError(msg);
      if (e instanceof EditorError && /^slug_|^title_|publish_needs_flag/.test(e.code)) setTab('basics');
      if (e instanceof EditorError && e.code === 'not_installed') setNotInstalled(true);
    }
    setSaving(false);
  };

  /* ---------------------------------------------------------- duplicate */

  const openDuplicate = () => {
    const title = `${form.basics.title} (copy)`;
    setDup({ title, slug: slugify(`${form.basics.slug}-copy`), start: form.basics.start, error: null, busy: false });
  };
  const runDuplicate = async () => {
    if (!dup || !glId) return;
    const slug = slugify(dup.slug);
    if (!dup.title.trim()) { setDup({ ...dup, error: t('adminEvents.dup.needTitle', 'Give the copy a title.') }); return; }
    if (!slug || !SLUG_RE.test(slug) || RESERVED_SLUGS.includes(slug)) {
      setDup({ ...dup, error: t('adminEvents.dup.needSlug', 'Give the copy its own web address (letters, numbers and dashes).') });
      return;
    }
    const tz = form.basics.timezone;
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
    setDup({ ...dup, busy: true, error: null });
    try {
      const res = await cloneEvent(glId, { event, registration: { slug } });
      setDup(null);
      toast({ title: t('adminEvents.dup.done', 'Copy created as a draft'), description: t('adminEvents.dup.doneBody', 'Check the dates and the online link before publishing it.') });
      navigate(`/admin/events/${res.event_id}`);
    } catch (e) {
      setDup((d) => (d ? { ...d, busy: false, error: editorErrorText(e) } : d));
    }
  };

  /* ---------------------------------------------------------- render */

  if (loading) return <AdminLoading />;
  if (loadError) {
    return (
      <div className="mx-auto max-w-3xl">
        <AdminDetailHeader back={{ to: '/admin/events', label: t('adminEvents.back', 'Events') }} title={t('adminEvents.editTitle', 'Event')} />
        <Note tone="danger">{loadError}</Note>
      </div>
    );
  }

  const b = form.basics;
  const tabWords: Record<EditorTab, string> = {
    basics: t('adminEvents.tab.basics', 'Basics'),
    registration: t('adminEvents.tab.registration', 'Registration'),
    questions: t('adminEvents.tab.questions', 'Questions'),
    emails: t('adminEvents.tab.emails', 'E-mails'),
    registrations: regCount
      ? t('adminEvents.tab.registrationsN', 'Registrations ({{n}})', { n: regCount })
      : t('adminEvents.tab.registrations', 'Registrations'),
  };
  const tabHasIssue = (x: EditorTab) => issues.some((i) => i.tab === x);
  const startIso = b.start ? wallToIso(b.start, b.timezone) : null;
  const visibilityPill = b.visibility === 'published'
    ? <AdminStatusPill tone="success">{t('adminEvents.basics.published', 'Published')}</AdminStatusPill>
    : b.visibility === 'hidden'
      ? <AdminStatusPill>{t('adminEvents.basics.hidden', 'Hidden test')}</AdminStatusPill>
      : <AdminStatusPill tone="warning">{t('adminEvents.basics.draft', 'Draft')}</AdminStatusPill>;

  return (
    <div className="mx-auto max-w-5xl">
      <AdminDetailHeader
        back={{ to: `/admin/events?type=${kind === 'webinar' ? 'webinar' : 'on_site'}`, label: t('adminEvents.back', 'Events') }}
        title={isNew
          ? (kind === 'webinar' ? t('adminEvents.newWebinar', 'New webinar') : t('adminEvents.newOnsite', 'New on-site event'))
          : b.title || t('adminEvents.untitled', 'Untitled event')}
        badges={(
          <>
            <AdminStatusPill tone={kind === 'onsite' ? 'navy' : 'neutral'}>{kind === 'onsite' ? t('adminEvents.basics.onsite', 'On-site event') : t('adminEvents.basics.webinar', 'Webinar')}</AdminStatusPill>
            {!isNew && visibilityPill}
            {!isNew && dirty.length > 0 && <AdminStatusPill tone="warning">{t('adminEvents.unsaved', 'Not saved yet')}</AdminStatusPill>}
          </>
        )}
        subtitle={startIso ? formatInZone(startIso, b.timezone, !b.isFullDay) : t('adminEvents.noDate', 'Date to be set')}
        actions={(
          <>
            {!isNew && eventId && (
              <Button asChild variant="outline" size="sm" className={ADMIN_BTN}>
                <a href={`/events/${eventId}`} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-4 w-4 sm:mr-1.5" aria-hidden="true" />
                  <span className="sr-only sm:not-sr-only">{t('adminEvents.view', 'View page')}</span>
                </a>
              </Button>
            )}
            {!isNew && glId && (
              <Button type="button" variant="outline" size="sm" className={ADMIN_BTN} onClick={openDuplicate}>
                <Copy className="h-4 w-4 sm:mr-1.5" aria-hidden="true" />
                <span className="sr-only sm:not-sr-only">{t('adminEvents.duplicate', 'Duplicate')}</span>
              </Button>
            )}
            <Button type="button" variant="secondary" size="sm" className={ADMIN_BTN_PRIMARY} onClick={save} disabled={saving || !hasChanges}>
              {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="mr-1.5 h-4 w-4" aria-hidden="true" />}
              {isNew ? t('adminEvents.create', 'Create the event') : t('adminEvents.save', 'Save changes')}
            </Button>
          </>
        )}
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
                    {(tabHasIssue(x) || (x !== 'registrations' && dirty.includes(x as FormSection) && !isNew)) && (
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

        {!isNew && loaded && !loaded.gl.legacy_event_id && tab === 'basics' && (
          <Note>
            {t('adminEvents.noCatalogue', 'This test event has no event page yet. Saving creates one, kept unpublished.')}
          </Note>
        )}
        {kind === 'onsite' && tab === 'basics' && (
          <Note>
            {t('adminEvents.onsiteLater', 'For on-site events, this page sets the basics. Registration settings, participation types and questions arrive in a later update. Meanwhile people register with their name, e-mail and the usual fields, and M3 checks each registration in the Registrations tab.')}
          </Note>
        )}

        {tab === 'basics' && (
          <BasicsTab
            value={b}
            onChange={(v) => setSection('basics', v)}
            issues={issues}
            isNew={isNew}
            slugLocked={!isNew && wasPublished}
            canPublish={canPublish}
            eventId={eventId}
          />
        )}
        {tab === 'registration' && (
          <RegistrationTab
            value={form.registration}
            onChange={(v) => setSection('registration', v)}
            issues={issues}
            timezone={b.timezone}
            eventStart={b.start}
          />
        )}
        {tab === 'questions' && (
          <QuestionsTab
            value={form.questions}
            onChange={(v) => setSection('questions', v)}
            issues={issues}
            kind={kind}
            hasRegistrations={regCount > 0}
          />
        )}
        {tab === 'emails' && (
          <EmailsTab value={form.emails} onChange={(v) => setSection('emails', v)} issues={issues} kind={kind} />
        )}
        {tab === 'registrations' && glId && loaded && (
          <EventRegistrationsPanel
            glEventId={glId}
            kind={kind}
            mode={loaded.gl.registration_mode ?? (kind === 'webinar' ? 'instant' : 'review')}
            capacity={loaded.gl.capacity}
            slug={loaded.gl.slug}
            timezone={initial.basics.timezone}
            questions={loaded.questions}
            onCount={setRegCount}
          />
        )}

        {tab !== 'registrations' && (
          <div className="flex flex-col-reverse gap-3 border-t border-rule pt-5 sm:flex-row sm:items-center sm:justify-end">
            {!isNew && dirty.length > 0 && (
              <Button type="button" variant="outline" size="sm" className={ADMIN_BTN} disabled={saving} onClick={() => { setForm(initial); setShowIssues(false); setSaveError(null); }}>
                {t('adminEvents.discard', 'Undo my changes')}
              </Button>
            )}
            <Button type="button" variant="secondary" size="sm" className={ADMIN_BTN_PRIMARY} onClick={save} disabled={saving || !hasChanges}>
              {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="mr-1.5 h-4 w-4" aria-hidden="true" />}
              {isNew ? t('adminEvents.create', 'Create the event') : t('adminEvents.save', 'Save changes')}
            </Button>
          </div>
        )}
      </div>

      <EditDialog
        open={!!dup}
        onOpenChange={(o) => { if (!o) setDup(null); }}
        title={t('adminEvents.dup.title', 'Duplicate this event')}
        description={dirty.length
          ? t('adminEvents.dup.bodyDirty', 'The copy takes the saved version: changes not saved yet are not copied. Registrations are never copied.')
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
              label={b.isFullDay ? t('adminEvents.basics.day', 'Day') : t('adminEvents.basics.start', 'Starts')}
              htmlFor="dup-start"
              hint={t('adminEvents.dup.startHint', 'In the same time zone as this event. You can change it later.')}
            >
              <Input
                id="dup-start"
                type={b.isFullDay ? 'date' : 'datetime-local'}
                value={b.isFullDay ? dup.start.slice(0, 10) : dup.start}
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
