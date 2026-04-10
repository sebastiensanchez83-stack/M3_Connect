import { useEffect, useState, Suspense } from 'react';
import { Routes, Route, useNavigate } from 'react-router-dom';
import { RefreshCw, Menu, X } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { AdminSidebar } from '@/components/admin/AdminSidebar';
import { lazyWithRetry } from '@/lib/lazyWithRetry';

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
const AdminResources = lazyWithRetry(() => import('@/components/admin/AdminResources').then(m => ({ default: m.AdminResources })));
const AdminResourceDetail = lazyWithRetry(() => import('@/components/admin/AdminResourceDetail').then(m => ({ default: m.AdminResourceDetail })));
const AdminEvents = lazyWithRetry(() => import('@/components/admin/AdminEvents').then(m => ({ default: m.AdminEvents })));
const AdminEventDetail = lazyWithRetry(() => import('@/components/admin/AdminEventDetail').then(m => ({ default: m.AdminEventDetail })));
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

function AdminLazyFallback() {
  return (
    <div className="flex items-center justify-center h-[50vh]">
      <RefreshCw className="h-8 w-8 animate-spin text-primary" />
    </div>
  );
}

/* ─── Admin / Moderator Page ─── */
export function AdminPage() {
  const { loading, isModerator } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  if (loading) return <div className="flex items-center justify-center h-screen"><RefreshCw className="h-8 w-8 animate-spin text-primary" /></div>;
  if (!isModerator) return null;

  return (
    <div className="flex relative">
      {/* Mobile sidebar toggle */}
      <Button
        variant="ghost"
        size="sm"
        className="md:hidden fixed top-[72px] left-2 z-50 bg-white shadow-md rounded-lg"
        onClick={() => setSidebarOpen(!sidebarOpen)}
      >
        {sidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </Button>
      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div className="md:hidden fixed inset-0 z-40 bg-black/30" onClick={() => setSidebarOpen(false)}>
          <div className="w-56 bg-white h-full shadow-xl overflow-y-auto" onClick={e => e.stopPropagation()}>
            <AdminSidebar mobile onNavigate={() => setSidebarOpen(false)} />
          </div>
        </div>
      )}
      <AdminSidebar />
      <div className="flex-1 p-4 md:p-8 bg-gray-50 min-h-[calc(100vh-64px)] overflow-auto">
        <Suspense fallback={<AdminLazyFallback />}>
          <Routes>
            <Route path="/" element={<AdminDashboard />} />
            <Route path="/users" element={<AdminOnlyGuard><AdminUsers /></AdminOnlyGuard>} />
            <Route path="/users/:id" element={<AdminOnlyGuard><AdminUserDetail /></AdminOnlyGuard>} />
            <Route path="/organizations" element={<AdminOnlyGuard><AdminOrganizations /></AdminOnlyGuard>} />
            <Route path="/resources" element={<AdminResources />} />
            <Route path="/resources/:id" element={<AdminResourceDetail />} />
            <Route path="/events" element={<AdminOnlyGuard><AdminEvents /></AdminOnlyGuard>} />
            <Route path="/events/:id" element={<AdminOnlyGuard><AdminEventDetail /></AdminOnlyGuard>} />
            {/* Partners merged into Users tab */}
            <Route path="/sponsorships" element={<AdminOnlyGuard><AdminSponsorships /></AdminOnlyGuard>} />
            <Route path="/sponsorships/:id" element={<AdminOnlyGuard><AdminSponsorshipDetail /></AdminOnlyGuard>} />
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
            <Route path="/settings" element={<AdminOnlyGuard><AdminPlatformSettings /></AdminOnlyGuard>} />
          </Routes>
        </Suspense>
      </div>
    </div>
  );
}
