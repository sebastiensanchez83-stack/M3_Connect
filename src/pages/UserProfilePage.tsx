import { useEffect, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { LoadingSkeleton } from '@/components/LoadingSkeleton';
import { fetchPeopleOrgs } from '@/lib/personOrg';

/**
 * /users/:id is no longer a page (Victor, Oct 2026: "no personal page at all"):
 * a person is shown by their photo, name, job title and company, and every link
 * goes to the company's page. This route stays so the old links (e-mails, shared
 * URLs, bookmarks) keep working: it sends the visitor, without a history entry,
 * to the page of the company the person speaks for (src/lib/personOrg.ts), or to
 * the directory when there is none (or the id is unknown).
 *
 * The "Request to connect" with a person is gone with the page: connections are
 * made with a company, from its page, and reach every member of it.
 */
export function UserProfilePage() {
  const { id } = useParams<{ id: string }>();
  const [target, setTarget] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setTarget(null);
    fetchPeopleOrgs([id])
      .then((orgs) => {
        if (!alive) return;
        const org = id ? orgs[id] : undefined;
        setTarget(org?.slug ? `/organizations/${org.slug}` : '/directory');
      })
      .catch(() => { if (alive) setTarget('/directory'); });
    return () => { alive = false; };
  }, [id]);

  if (!target) return <LoadingSkeleton variant="screen" />;
  return <Navigate to={target} replace />;
}
