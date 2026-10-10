import { Suspense, useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useRegistrationFlags } from '@/lib/flags';
import { lazyWithRetry } from '@/lib/lazyWithRetry';
import { AdminLoading } from '../AdminUI';
import { EventEditor } from './EventEditor';
import { findGlEvent } from './eventAdmin';

const AdminEventDetail = lazyWithRetry(() => import('../AdminEventDetail').then((m) => ({ default: m.AdminEventDetail })));

/**
 * Which editor opens on /admin/events/new and /admin/events/:id.
 *
 *   - An event that registers through the new core (gl_event, engine core_v2) ALWAYS
 *     opens the new editor: the old one would write the join link into the public
 *     catalogue row and bypass the registration settings.
 *   - Every other existing event (legacy webinars, SM26, the WYS catalogue row) keeps
 *     the old editor, unchanged.
 *   - A NEW event opens the new editor once the registration switch of its type is on
 *     (webinar_v2 / onsite_v2), or when asked with ?editor=new (staff tests: while the
 *     switch is off the database keeps such an event unpublished). Otherwise the old
 *     editor, exactly as before.
 * Each URL gets its own instance (key), so a new event never inherits the last one's form.
 */
export function EventEditorRoute() {
  const { id = '' } = useParams<{ id: string }>();
  const [params] = useSearchParams();
  const { flags, ready } = useRegistrationFlags();
  const isNew = id === 'new';
  const type = params.get('type');
  const kind = type === 'on_site' ? 'onsite' : 'webinar';
  const forced = params.get('editor') === 'new';
  // The answer is kept with the id it belongs to: going straight from one event to another
  // must not mount the previous answer's editor on the new id, even for one render.
  const [resolved, setResolved] = useState<{ id: string; target: 'core' | 'legacy' } | null>(null);
  const target = resolved && resolved.id === id ? resolved.target : 'pending';

  useEffect(() => {
    if (isNew) return;
    let alive = true;
    findGlEvent(id)
      .then((gl) => { if (alive) setResolved({ id, target: gl?.engine === 'core_v2' ? 'core' : 'legacy' }); })
      .catch(() => { if (alive) setResolved({ id, target: 'legacy' }); });
    return () => { alive = false; };
  }, [id, isNew]);

  const legacy = (
    <Suspense fallback={<AdminLoading />}>
      <AdminEventDetail key={`${id}:${type ?? ''}`} />
    </Suspense>
  );

  if (isNew) {
    if (!forced && !ready) return <AdminLoading />;
    const on = forced || (kind === 'webinar' ? flags.webinar_v2 : flags.onsite_v2);
    return on ? <EventEditor key={`new:${kind}`} routeId="new" initialKind={kind} /> : legacy;
  }
  if (target === 'pending') return <AdminLoading />;
  return target === 'core' ? <EventEditor key={id} routeId={id} initialKind={kind} /> : legacy;
}
