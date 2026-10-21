import { LegacyRequestsRedirect } from './v2/market/legacyRedirects';

/** Partner leads now live in Admin > Marina requests (21 Oct 2026); this old address opens it. */
export function AdminLeads() {
  return <LegacyRequestsRedirect kind="lead" />;
}
