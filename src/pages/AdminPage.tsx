import { useEffect, useState, Suspense } from 'react';
import { Link, Routes, Route, Navigate, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { RefreshCw, Menu, X } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/hooks/use-toast';
import { AdminSidebar } from '@/components/admin/AdminSidebar';
import { AdminLoading } from '@/components/admin/AdminUI';
import { ReviewCountContext, useReviewCountSource } from '@/components/admin/reviewQueueCount';
import { lazyWithRetry } from '@/lib/lazyWithRetry';
import '@/styles/admin-skin.css';

/* ─── Lazy admin sub-pages ───
 * Each admin screen is code-split into its own chunk so the AdminPage bundle
 * shrinks dramatically. The sidebar + dashboard still load on /admin, and
 * every other tab is fetched on-demand. Each uses lazyWithRetry so stale
 * chunks after a deploy trigger a one-shot auto-reload instead of crashing.
 */
const AdminDashboard = lazyWithRetry(() => import('@/components/admin/AdminDashboard').then(m => ({ default: m.AdminDashboard })));
const AdminUsers = lazyWithRetry(() => import('@/components/admin/AdminUsers').then(m => ({ default: m.AdminUsers })));
const AdminUserDetail = lazyWithRetry(() => import('@/components/admin/AdminUserDetail').then(m => ({ default: m.AdminUserDetail })));
const AdminOrganizations = lazyWithRetry(() => import('@/components/admin/AdminOrganizations').then(m => ({ default: m.AdminOrganizations })));
const AdminOrganizationDetail = lazyWithRetry(() => import('@/components/admin/AdminOrganizationDetail').then(m => ({ default: m.AdminOrganizationDetail })));
const AdminResources = lazyWithRetry(() => import('@/components/admin/AdminResources').then(m => ({ default: m.AdminResources })));
const AdminResourceDetail = lazyWithRetry(() => import('@/components/admin/AdminResourceDetail').then(m => ({ default: m.AdminResourceDetail })));
const AdminEvents = lazyWithRetry(() => import('@/components/admin/AdminEvents').then(m => ({ default: m.AdminEvents })));
const AdminEventDetail = lazyWithRetry(() => import('@/components/admin/AdminEventDetail').then(m => ({ default: m.AdminEventDetail })));
// Sponsorship panel repurposed into the fulfilment tracker (shared with the
// top-level /sponsorship route so Yacht Club de Monaco reaches the same hub).
const SponsorshipHub = lazyWithRetry(() => import('@/components/sponsorship/SponsorshipHub').then(m => ({ default: m.SponsorshipHub })));
const SponsorAgreementDetail = lazyWithRetry(() => import('@/components/sponsorship/SponsorAgreementDetail').then(m => ({ default: m.SponsorAgreementDetail })));
// The old tier-upgrade "sponsorship requests" review and the exposition/booth
// review keep their own routes — BOTH still have live intakes (OrganizationTab
// tier-upgrade requests; EventRegistrationFlow booth requests). The new
// fulfilment tracker is a separate surface at /admin/sponsorships. Exposition
// logistics will eventually move to a dedicated logistics module; the
// "exhibition space" entitlement also survives as a tracked sponsorship deliverable.
const AdminSponsorships = lazyWithRetry(() => import('@/components/admin/AdminSponsorships').then(m => ({ default: m.AdminSponsorships })));
const AdminSponsorshipDetail = lazyWithRetry(() => import('@/components/admin/AdminSponsorshipDetail').then(m => ({ default: m.AdminSponsorshipDetail })));
const AdminExpositions = lazyWithRetry(() => import('@/components/admin/AdminExpositions').then(m => ({ default: m.AdminExpositions })));
const AdminExpositionDetail = lazyWithRetry(() => import('@/components/admin/AdminExpositionDetail').then(m => ({ default: m.AdminExpositionDetail })));
const AdminProjects = lazyWithRetry(() => import('@/components/admin/AdminProjects').then(m => ({ default: m.AdminProjects })));
const AdminProjectDetail = lazyWithRetry(() => import('@/components/admin/AdminProjectDetail').then(m => ({ default: m.AdminProjectDetail })));
const AdminLeads = lazyWithRetry(() => import('@/components/admin/AdminLeads').then(m => ({ default: m.AdminLeads })));
const AdminLeadDetail = lazyWithRetry(() => import('@/components/admin/AdminLeadDetail').then(m => ({ default: m.AdminLeadDetail })));
const AdminWebinarRequests = lazyWithRetry(() => import('@/components/admin/AdminWebinarRequests').then(m => ({ default: m.AdminWebinarRequests })));
const AdminWebinarDetail = lazyWithRetry(() => import('@/components/admin/AdminWebinarDetail').then(m => ({ default: m.AdminWebinarDetail })));
const AdminPartnerRequests = lazyWithRetry(() => import('@/components/admin/AdminPartnerRequests').then(m => ({ default: m.AdminPartnerRequests })));
const AdminPartnerRequestDetail = lazyWithRetry(() => import('@/components/admin/AdminPartnerRequestDetail').then(m => ({ default: m.AdminPartnerRequestDetail })));
const AdminRFPs = lazyWithRetry(() => import('@/components/admin/AdminRFPs').then(m => ({ default: m.AdminRFPs })));
const AdminRFPDetail = lazyWithRetry(() => import('@/components/admin/AdminRFPDetail').then(m => ({ default: m.AdminRFPDetail })));
const AdminConsultations = lazyWithRetry(() => import('@/components/admin/AdminConsultations').then(m => ({ default: m.AdminConsultations })));
const AdminConsultationDetail = lazyWithRetry(() => import('@/components/admin/AdminConsultationDetail').then(m => ({ default: m.AdminConsultationDetail })));
const AdminBanners = lazyWithRetry(() => import('@/components/admin/AdminBanners').then(m => ({ default: m.AdminBanners })));
const AdminBannerDetail = lazyWithRetry(() => import('@/components/admin/AdminBannerDetail').then(m => ({ default: m.AdminBannerDetail })));
const AdminPlatformSettings = lazyWithRetry(() => import('@/components/admin/AdminPlatformSettings').then(m => ({ default: m.AdminPlatformSettings })));
const AdminSectors = lazyWithRetry(() => import('@/components/admin/AdminSectors').then(m => ({ default: m.AdminSectors })));
const AdminPulse = lazyWithRetry(() => import('@/components/admin/AdminPulse').then(m => ({ default: m.AdminPulse })));
const AdminSM26 = lazyWithRetry(() => import('@/components/admin/AdminSM26').then(m => ({ default: m.AdminSM26 })));
const AdminSM26Detail = lazyWithRetry(() => import('@/components/admin/AdminSM26Detail').then(m => ({ default: m.AdminSM26Detail })));
const AdminSM26Invitations = lazyWithRetry(() => import('@/components/admin/AdminSM26Invitations').then(m => ({ default: m.AdminSM26Invitations })));
const AdminSM26Ecat = lazyWithRetry(() => import('@/components/admin/AdminSM26Ecat').then(m => ({ default: m.AdminSM26Ecat })));
const AdminSM26MediaKits = lazyWithRetry(() => import('@/components/admin/AdminSM26MediaKits').then(m => ({ default: m.AdminSM26MediaKits })));
const AdminSM26EcatDossier = lazyWithRetry(() => import('@/components/admin/AdminSM26EcatDossier').then(m => ({ default: m.AdminSM26EcatDossier })));
const AdminSM26Agenda = lazyWithRetry(() => import('@/components/admin/AdminSM26Agenda').then(m => ({ default: m.AdminSM26Agenda })));
const AdminSM26Checkin = lazyWithRetry(() => import('@/components/admin/AdminSM26Checkin').then(m => ({ default: m.AdminSM26Checkin })));
const AdminSM26Evaluation = lazyWithRetry(() => import('@/components/admin/AdminSM26Evaluation').then(m => ({ default: m.AdminSM26Evaluation })));
const AdminSM26Networking = lazyWithRetry(() => import('@/components/admin/AdminSM26Networking').then(m => ({ default: m.AdminSM26Networking })));
const AdminSM26Architecture = lazyWithRetry(() => import('@/components/admin/AdminSM26Architecture').then(m => ({ default: m.AdminSM26Architecture })));
const AdminSM26Feedback = lazyWithRetry(() => import('@/components/admin/AdminSM26Feedback').then(m => ({ default: m.AdminSM26Feedback })));
const AdminSM26Health = lazyWithRetry(() => import('@/components/admin/AdminSM26Health').then(m => ({ default: m.AdminSM26Health })));
const AdminSM26Logistics = lazyWithRetry(() => import('@/components/admin/AdminSM26Logistics').then(m => ({ default: m.AdminSM26Logistics })));
const AdminSM26Import = lazyWithRetry(() => import('@/components/admin/AdminSM26Import').then(m => ({ default: m.AdminSM26Import })));
const AdminMediaDownloads = lazyWithRetry(() => import('@/components/admin/AdminMediaDownloads').then(m => ({ default: m.AdminMediaDownloads })));
const AdminGuestList = lazyWithRetry(() => import('@/components/admin/AdminGuestList').then(m => ({ default: m.AdminGuestList })));
const AdminGuestCheckin = lazyWithRetry(() => import('@/components/admin/AdminGuestCheckin').then(m => ({ default: m.AdminGuestCheckin })));
const AdminReviewQueue = lazyWithRetry(() => import('@/components/admin/AdminReviewQueue').then(m => ({ default: m.AdminReviewQueue })));

/* ─── Admin-only Route Guard ─── */
function AdminOnlyGuard({ children }: { children: React.ReactNode }) {
  const { isAdmin } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isAdmin) {
      navigate('/admin', { replace: true });
      toast({ title: 'Admin access required', variant: 'destructive' });
    }
  }, [isAdmin, navigate]);

  if (!isAdmin) return null;
  return <>{children}</>;
}

/**
 * One event editor per URL. Going from /admin/events/<id> to /admin/events/new?type=…
 * (sidebar links) would otherwise reuse the instance and carry the previous event's
 * form, pricing and cover into the new one.
 */
function KeyedAdminEventDetail() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  return <AdminEventDetail key={`${id}:${searchParams.get('type') ?? ''}`} />;
}

function AdminLazyFallback() {
  return <AdminLoading className="h-[50vh]" />;
}

/* ─── Admin / Moderator Page ─── */
export function AdminPage() {
  const { t } = useTranslation();
  const { loading, isAdmin, isModerator, user } = useAuth();
  const { pathname } = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // One figure for the whole admin area (sidebar badge, phone bar, dashboard card).
  const review = useReviewCountSource(isModerator, user?.id, pathname);
  const reviewCount = review.count;

  // Escape closes the phone menu.
  useEffect(() => {
    if (!sidebarOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSidebarOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sidebarOpen]);

  if (loading) return <div className="flex items-center justify-center h-screen"><RefreshCw className="h-8 w-8 animate-spin text-primary" /></div>;
  if (!isModerator) return null;

  // The SM26 consoles (/admin/sm26*) are frozen: they keep their original
  // content frame and are not touched by the admin skin. Only the rail around
  // them follows the new look.
  const frozen = pathname.startsWith('/admin/sm26');

  return (
    <ReviewCountContext.Provider value={review}>
    <div className="flex min-h-[calc(100vh-4rem)] bg-page">
      <AdminSidebar reviewCount={reviewCount} />
      <div className="min-w-0 flex-1">
        {/* Phone bar: opens the menu (the rail is hidden below md) */}
        <div className="sticky top-16 z-30 flex h-12 items-center gap-2 border-b border-rule bg-white px-3 md:hidden">
          <button
            type="button"
            onClick={() => setSidebarOpen(o => !o)}
            aria-expanded={sidebarOpen}
            aria-label={sidebarOpen ? t('adminUi.closeMenu') : t('adminUi.openMenu')}
            className="grid h-9 w-9 place-items-center rounded-pill text-navy transition-colors hover:bg-chip focus:outline-none focus-visible:shadow-focus"
          >
            {sidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
          <span className="text-[14px] font-semibold text-navy">{isAdmin ? t('adminUi.adminArea') : t('adminUi.moderatorArea')}</span>
          {/* The rail is hidden on a phone: say here that items are waiting. */}
          {!!reviewCount && !pathname.startsWith('/admin/review') && (
            <Link
              to="/admin/review"
              aria-label={t('adminReview.card.count', { count: reviewCount, defaultValue_one: '{{count}} item to review', defaultValue_other: '{{count}} items to review' })}
              className="ml-auto inline-flex h-11 shrink-0 items-center gap-1.5 rounded-pill bg-gold px-3 text-[13px] font-bold text-navy transition-colors hover:bg-gold/80 focus:outline-none focus-visible:shadow-focus"
            >
              {t('adminReview.nav', 'To review')}
              <span className="tabular-nums">{reviewCount}</span>
            </Link>
          )}
        </div>
        {/* Phone menu */}
        {sidebarOpen && (
          <div className="fixed inset-x-0 bottom-0 top-16 z-40 md:hidden" role="dialog" aria-modal="true" aria-label={t('adminUi.menu')}>
            <div className="absolute inset-0 bg-navy-deep/45" onClick={() => setSidebarOpen(false)} aria-hidden="true" />
            <div className="relative h-full w-64 max-w-[85vw] shadow-drawer">
              <AdminSidebar mobile onNavigate={() => setSidebarOpen(false)} reviewCount={reviewCount} />
            </div>
          </div>
        )}
        <div className={frozen ? 'p-4 md:p-8 bg-gray-50 min-h-[calc(100vh-64px)] overflow-auto' : 'admin-skin mx-auto w-full max-w-[1360px] px-4 py-6 md:px-8 md:py-8'}>
        <Suspense fallback={<AdminLazyFallback />}>
          <Routes>
            <Route path="/" element={<AdminDashboard />} />
            {/* Moderators too: admin_review_queue() gives them only what their screens can open. */}
            <Route path="/review" element={<AdminReviewQueue />} />
            <Route path="/users" element={<AdminOnlyGuard><AdminUsers /></AdminOnlyGuard>} />
            <Route path="/users/:id" element={<AdminOnlyGuard><AdminUserDetail /></AdminOnlyGuard>} />
            <Route path="/organizations" element={<AdminOnlyGuard><AdminOrganizations /></AdminOnlyGuard>} />
            <Route path="/organizations/:id" element={<AdminOnlyGuard><AdminOrganizationDetail /></AdminOnlyGuard>} />
            <Route path="/resources" element={<AdminResources />} />
            <Route path="/resources/:id" element={<AdminResourceDetail />} />
            <Route path="/events" element={<AdminOnlyGuard><AdminEvents /></AdminOnlyGuard>} />
            <Route path="/events/:id" element={<AdminOnlyGuard><KeyedAdminEventDetail /></AdminOnlyGuard>} />
            <Route path="/sm26" element={<AdminOnlyGuard><AdminSM26 /></AdminOnlyGuard>} />
            <Route path="/sm26/evaluation" element={<AdminOnlyGuard><AdminSM26Evaluation /></AdminOnlyGuard>} />
            {/* Jury and Awards are tabs of Evaluation; their old stand-alone pages had no link left. */}
            <Route path="/sm26/jury" element={<Navigate to="/admin/sm26/evaluation" replace />} />
            <Route path="/sm26/agenda" element={<AdminOnlyGuard><AdminSM26Agenda /></AdminOnlyGuard>} />
            <Route path="/sm26/checkin" element={<AdminOnlyGuard><AdminSM26Checkin /></AdminOnlyGuard>} />
            <Route path="/sm26/health" element={<AdminOnlyGuard><AdminSM26Health /></AdminOnlyGuard>} />
            <Route path="/sm26/awards" element={<Navigate to="/admin/sm26/evaluation" replace />} />
            <Route path="/sm26/feedback" element={<AdminOnlyGuard><AdminSM26Feedback /></AdminOnlyGuard>} />
            <Route path="/sm26/logistics" element={<AdminOnlyGuard><AdminSM26Logistics /></AdminOnlyGuard>} />
            <Route path="/sm26/ecat" element={<AdminOnlyGuard><AdminSM26Ecat /></AdminOnlyGuard>} />
            <Route path="/sm26/mediakits" element={<AdminOnlyGuard><AdminSM26MediaKits /></AdminOnlyGuard>} />
            <Route path="/sm26/ecat/:pageId/dossier" element={<AdminOnlyGuard><AdminSM26EcatDossier /></AdminOnlyGuard>} />
            <Route path="/sm26/networking" element={<AdminOnlyGuard><AdminSM26Networking /></AdminOnlyGuard>} />
            <Route path="/sm26/architecture" element={<AdminOnlyGuard><AdminSM26Architecture /></AdminOnlyGuard>} />
            <Route path="/sm26/import" element={<AdminOnlyGuard><AdminSM26Import /></AdminOnlyGuard>} />
            <Route path="/sm26/invitations" element={<AdminOnlyGuard><AdminSM26Invitations /></AdminOnlyGuard>} />
            <Route path="/guest-list/:slug" element={<AdminOnlyGuard><AdminGuestList /></AdminOnlyGuard>} />
            {/* The entry QR in guest emails encodes this URL. Moderators may work the door: gl_checkin checks is_moderator itself. */}
            <Route path="/guest-list/:slug/checkin" element={<AdminGuestCheckin />} />
            <Route path="/media-downloads" element={<AdminOnlyGuard><AdminMediaDownloads /></AdminOnlyGuard>} />
            <Route path="/sm26/:id" element={<AdminOnlyGuard><AdminSM26Detail /></AdminOnlyGuard>} />
            {/* Partners merged into Users tab */}
            <Route path="/sponsorships" element={<AdminOnlyGuard><SponsorshipHub basePath="/admin/sponsorships" /></AdminOnlyGuard>} />
            <Route path="/sponsorships/:sponsorId" element={<AdminOnlyGuard><SponsorAgreementDetail basePath="/admin/sponsorships" /></AdminOnlyGuard>} />
            <Route path="/sponsorship-requests" element={<AdminOnlyGuard><AdminSponsorships /></AdminOnlyGuard>} />
            <Route path="/sponsorship-requests/:id" element={<AdminOnlyGuard><AdminSponsorshipDetail /></AdminOnlyGuard>} />
            <Route path="/expositions" element={<AdminOnlyGuard><AdminExpositions /></AdminOnlyGuard>} />
            <Route path="/expositions/:id" element={<AdminOnlyGuard><AdminExpositionDetail /></AdminOnlyGuard>} />
            <Route path="/projects" element={<AdminOnlyGuard><AdminProjects /></AdminOnlyGuard>} />
            <Route path="/projects/:id" element={<AdminOnlyGuard><AdminProjectDetail /></AdminOnlyGuard>} />
            <Route path="/leads" element={<AdminOnlyGuard><AdminLeads /></AdminOnlyGuard>} />
            <Route path="/leads/:id" element={<AdminOnlyGuard><AdminLeadDetail /></AdminOnlyGuard>} />
            <Route path="/webinars" element={<AdminWebinarRequests />} />
            <Route path="/webinars/:id" element={<AdminWebinarDetail />} />
            <Route path="/partner-requests" element={<AdminOnlyGuard><AdminPartnerRequests /></AdminOnlyGuard>} />
            <Route path="/partner-requests/:id" element={<AdminOnlyGuard><AdminPartnerRequestDetail /></AdminOnlyGuard>} />
            <Route path="/rfps" element={<AdminOnlyGuard><AdminRFPs /></AdminOnlyGuard>} />
            <Route path="/rfps/:id" element={<AdminOnlyGuard><AdminRFPDetail /></AdminOnlyGuard>} />
            <Route path="/consultations" element={<AdminOnlyGuard><AdminConsultations /></AdminOnlyGuard>} />
            <Route path="/consultations/:id" element={<AdminOnlyGuard><AdminConsultationDetail /></AdminOnlyGuard>} />
            <Route path="/banners" element={<AdminOnlyGuard><AdminBanners /></AdminOnlyGuard>} />
            <Route path="/banners/:id" element={<AdminOnlyGuard><AdminBannerDetail /></AdminOnlyGuard>} />
            <Route path="/sectors" element={<AdminOnlyGuard><AdminSectors /></AdminOnlyGuard>} />
            <Route path="/pulse" element={<AdminOnlyGuard><AdminPulse /></AdminOnlyGuard>} />
            <Route path="/settings" element={<AdminOnlyGuard><AdminPlatformSettings /></AdminOnlyGuard>} />
          </Routes>
        </Suspense>
        </div>
      </div>
    </div>
    </ReviewCountContext.Provider>
  );
}
