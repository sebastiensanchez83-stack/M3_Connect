import { LegacyRequestRedirect } from './v2/market/legacyRedirects';

/** Requests for proposals now live in Admin > Marina requests (21 Oct 2026); this old address opens it. */
export function AdminRFPDetail() {
  return <LegacyRequestRedirect kind="rfp" />;
}
