import { LegacyRequestRedirect } from './v2/market/legacyRedirects';

/** Consultations now live in Admin > Marina requests (21 Oct 2026); this old address opens it. */
export function AdminConsultationDetail() {
  return <LegacyRequestRedirect kind="consultation" />;
}
