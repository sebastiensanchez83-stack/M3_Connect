import { Suspense, useEffect, useState } from 'react';
import { Navigate, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';
import { lazyWithRetry } from '@/lib/lazyWithRetry';
import { ADMIN_BTN, AdminDetailHeader, AdminLoading } from '../../AdminUI';
import { EventEditor } from '../../events/EventEditor';
import { Note } from '../../events/editorUi';
import { findGlEvent } from '../../events/eventAdmin';
import { EventEditorRoute } from '../../events/EventEditorRoute';
import { LegacyEventPage } from './LegacyEventPage';

const AdminEventDetail = lazyWithRetry(() => import('../../AdminEventDetail').then((m) => ({ default: m.AdminEventDetail })));

/**
 * /admin/events/:id, ONE page per event (Victor, 21 Oct 2026), whatever system holds it:
 *
 *   - made with the new event editor (gl_event engine core_v2, by its catalogue id or, for a
 *     test without a public page, its gl_event id): the event page with every tab, the editor's
 *     settings included (EventEditor);
 *   - the public page of a guest list (engine guest_list_v1) or of a fair (sm_event): sent to
 *     that system's page, /admin/events/guest-list/<slug> or /admin/events/fair/<slug>, keeping
 *     ?tab= (the old links to /admin/events/<id> keep working);
 *   - any other events row: an event of the old system (LegacyEventPage).
 *
 * A failed lookup opens nothing but a retry note: guessing "old system" for a core_v2 event
 * would send it to the old editor, which can overwrite or delete it.
 */

type Target =
  | { kind: 'core'; glKind: 'webinar' | 'onsite' }
  | { kind: 'redirect'; to: string }
  | { kind: 'legacy' }
  | { kind: 'error' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function resolveEvent(id: string): Promise<Target> {
  const gl = await findGlEvent(id);
  if (gl?.engine === 'core_v2') return { kind: 'core', glKind: gl.kind === 'onsite' ? 'onsite' : 'webinar' };
  if (gl) return { kind: 'redirect', to: `/admin/events/guest-list/${encodeURIComponent(gl.slug)}` };
  if (UUID.test(id)) {
    const { data, error } = await supabase.from('sm_event').select('slug').or(`legacy_event_id.eq.${id},id.eq.${id}`).limit(1).maybeSingle();
    if (error) throw new Error(error.message);
    if (data?.slug) return { kind: 'redirect', to: `/admin/events/fair/${encodeURIComponent(data.slug as string)}` };
  }
  return { kind: 'legacy' };
}

function useResolved(id: string): [Target | null, () => void] {
  const [resolved, setResolved] = useState<{ id: string; target: Target } | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    setResolved(null);
    resolveEvent(id)
      .then(target => { if (alive) setResolved({ id, target }); })
      .catch(() => { if (alive) setResolved({ id, target: { kind: 'error' } }); });
    return () => { alive = false; };
  }, [id, attempt]);
  // Kept with the id it belongs to: going from one event to another never shows the last one's page.
  return [resolved && resolved.id === id ? resolved.target : null, () => setAttempt(n => n + 1)];
}

function RetryNote({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="mx-auto max-w-3xl">
      <AdminDetailHeader back={{ to: '/admin/events', label: t('adminEventsV2.back', 'All events') }} title={t('adminEvents.editTitle', 'Event')} />
      <Note tone="danger">
        <span role="alert">{t('adminEvents.routeError', 'The event could not be loaded. Check your connection and try again.')}</span>
      </Note>
      <Button type="button" variant="outline" size="sm" className={`${ADMIN_BTN} mt-4`} onClick={onRetry}>
        <RefreshCw className="mr-1.5 h-4 w-4" aria-hidden="true" /> {t('adminEvents.tryAgainBtn', 'Try again')}
      </Button>
    </div>
  );
}

export function EventPageRoute() {
  const { id = '' } = useParams<{ id: string }>();
  // /admin/events/new: the choice of editor for a new event (EventEditorRoute reads :id itself).
  if (id === 'new') return <EventEditorRoute />;
  return <ExistingEventRoute key={id} id={id} />;
}

function ExistingEventRoute({ id }: { id: string }) {
  const { search } = useLocation();
  const [params] = useSearchParams();
  const [target, retry] = useResolved(id);
  if (!target) return <AdminLoading />;
  if (target.kind === 'error') return <RetryNote onRetry={retry} />;
  if (target.kind === 'redirect') return <Navigate to={`${target.to}${search}`} replace />;
  if (target.kind === 'core') {
    return <EventEditor key={id} routeId={id} initialKind={target.glKind} forced={params.get('editor') === 'new'} />;
  }
  return <LegacyEventPage key={id} id={id} />;
}

/**
 * /admin/events/:id/edit: the OLD event editor, unchanged, for what it still edits: an
 * old-system event, and the public page (title, dates, text, photo) of a guest list or a fair.
 * Never for an event of the new editor: that one opens its own Settings tab instead.
 */
export function LegacyEditorRoute() {
  const { id = '' } = useParams<{ id: string }>();
  const [state, setState] = useState<{ id: string; core: boolean | null } | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    setState(null);
    findGlEvent(id)
      .then(gl => { if (alive) setState({ id, core: gl?.engine === 'core_v2' }); })
      .catch(() => { if (alive) setState({ id, core: null }); });
    return () => { alive = false; };
  }, [id, attempt]);
  const s = state && state.id === id ? state : null;
  if (!s) return <AdminLoading />;
  if (s.core === null) return <RetryNote onRetry={() => setAttempt(n => n + 1)} />;
  if (s.core) return <Navigate to={`/admin/events/${id}?tab=basics`} replace />;
  return (
    <Suspense fallback={<AdminLoading />}>
      <AdminEventDetail key={id} />
    </Suspense>
  );
}
