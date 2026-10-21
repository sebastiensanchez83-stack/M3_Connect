import { Suspense, useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowRight, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useRegistrationFlags } from '@/lib/flags';
import { lazyWithRetry } from '@/lib/lazyWithRetry';
import { ADMIN_BTN, AdminDetailHeader, AdminLoading } from '../AdminUI';
import { EventEditor } from './EventEditor';
import { Note } from './editorUi';
import { findGlEvent } from './eventAdmin';
import { CreateEventChooser } from '../v2/events/CreateEventChooser';

const AdminEventDetail = lazyWithRetry(() => import('../AdminEventDetail').then((m) => ({ default: m.AdminEventDetail })));

type Target = 'core' | 'legacy' | 'error';

/**
 * Which editor opens on /admin/events/new (and, before the event pages of wave 2, on
 * /admin/events/:id: that address is now v2/events/EventPageRoute, which keeps the same
 * core_v2 rule; this component still handles an existing id the same way if mounted on one).
 * /admin/events/new without ?type= shows the choice between an on-site event and a webinar.
 *
 *   - An event that registers through the new core (gl_event, engine core_v2) ALWAYS
 *     opens the new editor: the old one would write the join link into the public
 *     catalogue row, bypass the registration settings and could delete the event.
 *   - Every other existing event (legacy webinars, SM26, the WYS catalogue row) keeps
 *     the old editor, unchanged.
 *   - When the lookup FAILS (network, expired session), neither editor opens: a retry
 *     note instead. Guessing "old editor" would expose a core_v2 event to it.
 *   - A NEW event opens the new editor once the registration switch of its type is on
 *     (webinar_v2 / onsite_v2), or when asked with ?editor=new (staff tests: while the
 *     switch is off the database keeps such an event unpublished). Otherwise the old
 *     editor, exactly as before; for a webinar, with a note above it that links to the
 *     new editor (a webinar made in the old one can never move to the new registration).
 * Each URL gets its own instance (key), so a new event never inherits the last one's form.
 */
export function EventEditorRoute() {
  const { t } = useTranslation();
  const { id = '' } = useParams<{ id: string }>();
  const [params] = useSearchParams();
  const { flags, ready, failed, retry: retryFlags } = useRegistrationFlags();
  const isNew = id === 'new';
  const type = params.get('type');
  const kind = type === 'on_site' ? 'onsite' : 'webinar';
  const forced = params.get('editor') === 'new';
  // The answer is kept with the id it belongs to: going straight from one event to another
  // must not mount the previous answer's editor on the new id, even for one render.
  const [resolved, setResolved] = useState<{ id: string; target: Target } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const target = resolved && resolved.id === id ? resolved.target : 'pending';

  useEffect(() => {
    if (isNew) return;
    let alive = true;
    setResolved(null);
    findGlEvent(id)
      .then((gl) => { if (alive) setResolved({ id, target: gl?.engine === 'core_v2' ? 'core' : 'legacy' }); })
      .catch(() => { if (alive) setResolved({ id, target: 'error' }); });
    return () => { alive = false; };
  }, [id, isNew, attempt]);

  const legacy = (
    <Suspense fallback={<AdminLoading />}>
      <AdminEventDetail key={`${id}:${type ?? ''}`} />
    </Suspense>
  );

  if (isNew) {
    // "Create an event" (the one menu entry) arrives without a type: ask which kind first.
    if (!type) return <CreateEventChooser />;
    if (!forced && !ready) return <AdminLoading />;
    // The switches could not be read (src/lib/flags.ts gives up after a few seconds):
    // "off" would be a guess, and a webinar made in the old editor stays there for good.
    if (!forced && failed) {
      return (
        <div className="mx-auto max-w-3xl">
          <AdminDetailHeader back={{ to: '/admin/events', label: t('adminEvents.back', 'Events') }} title={t('adminEvents.newTitle', 'New event')} />
          <Note tone="danger">
            <span role="alert">{t('adminEvents.routeFlagsError', 'The registration settings could not be loaded, so the right editor cannot be chosen. Check your connection and try again.')}</span>
          </Note>
          <Button type="button" variant="outline" size="sm" className={`${ADMIN_BTN} mt-4`} onClick={retryFlags}>
            <RefreshCw className="mr-1.5 h-4 w-4" aria-hidden="true" /> {t('adminEvents.tryAgainBtn', 'Try again')}
          </Button>
        </div>
      );
    }
    const on = forced || (kind === 'webinar' ? flags.webinar_v2 : flags.onsite_v2);
    if (on) return <EventEditor key={`new:${kind}`} routeId="new" initialKind={kind} forced={forced} />;
    if (kind !== 'webinar') return legacy;
    // A webinar made in the current editor stays on the old registration for good (no
    // conversion; a copy needs a new-system event). Point to the new editor meanwhile.
    return (
      <>
        <div className="mx-auto mb-4 max-w-4xl">
          <Note>
            <span className="block font-semibold">{t('adminEvents.route.newSystemTitle', 'New registration system')}</span>
            <span className="mt-1 block">
              {t('adminEvents.route.newSystemBody', 'Prepare new webinars there: registration, questions, reminders and the list of people in one place. The webinar stays a draft until the new event pages are live. A webinar created on this page stays on the old registration.')}
            </span>
            <Button asChild variant="outline" size="sm" className={`${ADMIN_BTN} mt-3 h-11 sm:h-10`}>
              <Link to="/admin/events/new?type=webinar&editor=new">
                {t('adminEvents.route.newSystemGo', 'Create it in the new system')}
                <ArrowRight className="ml-1.5 h-4 w-4" aria-hidden="true" />
              </Link>
            </Button>
          </Note>
        </div>
        {legacy}
      </>
    );
  }
  if (target === 'pending') return <AdminLoading />;
  if (target === 'error') {
    return (
      <div className="mx-auto max-w-3xl">
        <AdminDetailHeader back={{ to: '/admin/events', label: t('adminEvents.back', 'Events') }} title={t('adminEvents.editTitle', 'Event')} />
        <Note tone="danger">
          <span role="alert">{t('adminEvents.routeError', 'The event could not be loaded. Check your connection and try again.')}</span>
        </Note>
        <Button type="button" variant="outline" size="sm" className={`${ADMIN_BTN} mt-4`} onClick={() => setAttempt((n) => n + 1)}>
          <RefreshCw className="mr-1.5 h-4 w-4" aria-hidden="true" /> {t('adminEvents.tryAgainBtn', 'Try again')}
        </Button>
      </div>
    );
  }
  return target === 'core' ? <EventEditor key={id} routeId={id} initialKind={kind} forced={forced} /> : legacy;
}
