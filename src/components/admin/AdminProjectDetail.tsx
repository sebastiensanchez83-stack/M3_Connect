import { LegacyRequestRedirect } from './v2/market/legacyRedirects';

/** Marina projects now live in Admin > Marina requests (21 Oct 2026); this old address opens it. */
export function AdminProjectDetail() {
  return <LegacyRequestRedirect kind="project" />;
}
