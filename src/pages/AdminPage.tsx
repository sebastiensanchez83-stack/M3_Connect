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
  AdminPartners,
  AdminSponsorships,
  AdminExpositions,
  AdminProjects,
  AdminLeads,
  AdminWebinarRequests,
  AdminPartnerRequests,
  AdminRFPs,
  AdminConsultations,
  AdminResourceDrafts,
} from '@/components/admin';

/* ─── Admin-only Route Guard ─── */
function AdminOnlyGuard({ children }: { children: React.ReactNode }) {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const isAdmin = profile?.persona === 'admin';

  useEffect(() => {
    if (!isAdmin) {
      navigate('/admin', { replace: true });
      toast({ title: 'Admin access required', variant: 'destructive' });
    }
  }, [isAdmin, navigate]);

  if (!isAdmin) return null;
  return <>{children}</>;
}

/* ─── Admin Page (root) ─── */
export function AdminPage() {
  const { user, loading, isModerator } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && (!user || !isModerator)) {
      navigate('/');
      toast({ title: 'Access denied. Admin only.', variant: 'destructive' });
    }
  }, [user, isModerator, loading, navigate]);

  if (loading) return <div className="flex items-center justify-center h-screen"><RefreshCw className="h-8 w-8 animate-spin text-primary" /></div>;
  if (!user || !isModerator) return null;

  return (
    <div className="flex">
      <AdminSidebar />
      <div className="flex-1 p-8 bg-gray-50 min-h-[calc(100vh-64px)] overflow-auto">
        <Routes>
          <Route path="/" element={<AdminDashboard />} />
          <Route path="/users" element={<AdminOnlyGuard><AdminUsers /></AdminOnlyGuard>} />
          <Route path="/resources" element={<AdminResources />} />
          <Route path="/events" element={<AdminOnlyGuard><AdminEvents /></AdminOnlyGuard>} />
          <Route path="/partners" element={<AdminOnlyGuard><AdminPartners /></AdminOnlyGuard>} />
          <Route path="/sponsorships" element={<AdminOnlyGuard><AdminSponsorships /></AdminOnlyGuard>} />
          <Route path="/expositions" element={<AdminOnlyGuard><AdminExpositions /></AdminOnlyGuard>} />
          <Route path="/projects" element={<AdminOnlyGuard><AdminProjects /></AdminOnlyGuard>} />
          <Route path="/leads" element={<AdminOnlyGuard><AdminLeads /></AdminOnlyGuard>} />
          <Route path="/webinars" element={<AdminWebinarRequests />} />
          <Route path="/partner-requests" element={<AdminOnlyGuard><AdminPartnerRequests /></AdminOnlyGuard>} />
          <Route path="/rfps" element={<AdminOnlyGuard><AdminRFPs /></AdminOnlyGuard>} />
          <Route path="/consultations" element={<AdminOnlyGuard><AdminConsultations /></AdminOnlyGuard>} />
          <Route path="/resource-drafts" element={<AdminResourceDrafts />} />
        </Routes>
      </div>
    </div>
  );
}
