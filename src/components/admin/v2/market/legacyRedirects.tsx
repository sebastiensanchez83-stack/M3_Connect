import { Navigate, useParams, useSearchParams } from 'react-router-dom';
import { statusFilterOf, type RequestKind } from './marketKinds';

/**
 * The four old marketplace screens (/admin/projects, /admin/rfps, /admin/consultations,
 * /admin/leads and their /:id) now open Admin > Marina requests (21 Oct 2026). Their addresses
 * stay valid for good: the review list, the admin home, the e-mails to M3 (rfp_submitted…) and
 * bookmarks point at them. A ?status= of the old lists becomes the matching filter.
 */

export function LegacyRequestsRedirect({ kind }: { kind: RequestKind }) {
  const [params] = useSearchParams();
  const next = new URLSearchParams({ kind });
  const status = statusFilterOf(params.get('status'));
  if (status) next.set('status', status);
  return <Navigate to={`/admin/requests?${next.toString()}`} replace />;
}

export function LegacyRequestRedirect({ kind }: { kind: RequestKind }) {
  const { id = '' } = useParams<{ id: string }>();
  return <Navigate to={id ? `/admin/requests/${kind}/${encodeURIComponent(id)}` : `/admin/requests?kind=${kind}`} replace />;
}
