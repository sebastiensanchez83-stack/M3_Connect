import { Navigate, useLocation } from 'react-router-dom';

/**
 * A permanent in-app redirect that keeps the query string and the hash: an old
 * /become-partner?persona=…#media link lands on /join?persona=…#media.
 * (React Router's <Navigate> alone drops them.)
 */
export function RedirectKeepingQuery({ to }: { to: string }) {
  const { search, hash } = useLocation();
  return <Navigate to={{ pathname: to, search, hash }} replace />;
}
