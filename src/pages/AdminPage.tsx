import { useEffect } from 'react';
import { Routes, Route, useNavigate } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/hooks/use-toast';
import {
  AdminSidebar,
  AdminDashboard,
  AdminUsers,
  AdminResources,
  AdminEvents,
  AdminEventDetail,
  AdminSponsorships,
  AdminExpositions,
  AdminProjects,
  AdminLeads,
  AdminWebinarRequests,
  AdminPartnerRequests,
  AdminRFPs,
  AdminConsultations,
  AdminResourceDrafts,
  AdminPlatformSettings,
} from '@/components/admin';

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

/* ─── Admin / Moderator Page ─── */
export function AdminPage() {
  const { loading, isModerator } = useAuth();

  if (loading) return <div className="flex items-center justify-center h-screen"><RefreshCw className="h-8 w-8 animate-spin text-primary" /></div>;
  if (!isModerator) return null;

  return (
    <div className="flex">
      <AdminSidebar />
      <div className="flex-1 p-8 bg-gray-50 min-h-[calc(100vh-64px)] overflow-auto">
        <Routes>
          <Route path="/" element={<AdminDashboard />} />
          <Route path="/users" element={<AdminOnlyGuard><AdminUsers /></AdminOnlyGuard>} />
          <Route path="/resources" element={<AdminResources />} />
          <Route path="/events" element={<AdminOnlyGuard><AdminEvents /></AdminOnlyGuard>} />
          <Route path="/events/:id" element={<AdminOnlyGuard><AdminEventDetail /></AdminOnlyGuard>} />
          {/* Partners merged into Users tab */}
          <Route path="/sponsorships" element={<AdminOnlyGuard><AdminSponsorships /></AdminOnlyGuard>} />
          <Route path="/expositions" element={<AdminOnlyGuard><AdminExpositions /></AdminOnlyGuard>} />
          <Route path="/projects" element={<AdminOnlyGuard><AdminProjects /></AdminOnlyGuard>} />
          <Route path="/leads" element={<AdminOnlyGuard><AdminLeads /></AdminOnlyGuard>} />
          <Route path="/webinars" element={<AdminWebinarRequests />} />
          <Route path="/partner-requests" element={<AdminOnlyGuard><AdminPartnerRequests /></AdminOnlyGuard>} />
          <Route path="/rfps" element={<AdminOnlyGuard><AdminRFPs /></AdminOnlyGuard>} />
          <Route path="/consultations" element={<AdminOnlyGuard><AdminConsultations /></AdminOnlyGuard>} />
          <Route path="/resource-drafts" element={<AdminResourceDrafts />} />
          <Route path="/settings" element={<AdminOnlyGuard><AdminPlatformSettings /></AdminOnlyGuard>} />
        </Routes>
      </div>
    </div>
  );
}
