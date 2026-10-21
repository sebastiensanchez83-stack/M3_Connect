import { LegacyRequestRedirect } from './v2/market/legacyRedirects';

/** Partner leads now live in Admin > Marina requests (21 Oct 2026); this old address opens it. */
export function AdminLeadDetail() {
  return <LegacyRequestRedirect kind="lead" />;
}
