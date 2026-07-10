import { useState, useEffect } from 'react';
import { Routes, Route } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { RefreshCw, Lock } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { SponsorshipHub } from '@/components/sponsorship/SponsorshipHub';
import { SponsorAgreementDetail } from '@/components/sponsorship/SponsorAgreementDetail';
import { SponsorPortal } from '@/components/sponsorship/SponsorPortal';

// Top-level sponsorship surface. Managers (M3 admin/moderator OR Yacht Club de
// Monaco) get the full fulfilment hub; a linked sponsor gets their own portal.
// Access is enforced by RLS; this only picks which view to render.

type Role = 'loading' | 'manager' | 'sponsor' | 'none';

export function SponsorshipPage() {
  const { user, loading: authLoading } = useAuth();
  const [role, setRole] = useState<Role>('loading');
  const [sponsorIds, setSponsorIds] = useState<string[]>([]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { setRole('none'); return; }
    (async () => {
      const { data: mgr } = await supabase.rpc('is_sponsorship_manager');
      if (mgr === true) { setRole('manager'); return; }
      const { data: su } = await supabase.from('sp_sponsor_user').select('sponsor_id').eq('user_id', user.id);
      const ids = ((su || []) as { sponsor_id: string }[]).map(x => x.sponsor_id);
      if (ids.length) { setSponsorIds(ids); setRole('sponsor'); } else setRole('none');
    })();
  }, [user, authLoading]);

  return (
    <div className="min-h-screen bg-gray-50">
      <Helmet><title>Sponsorship — Smart Marina Connect</title></Helmet>
      <div className="container mx-auto px-4 py-8">
        {role === 'loading' && <div className="flex items-center justify-center h-[50vh]"><RefreshCw className="h-8 w-8 animate-spin text-primary" /></div>}
        {role === 'none' && (
          <div className="max-w-md mx-auto py-16 text-center">
            <Lock className="h-10 w-10 text-gray-300 mx-auto mb-3" />
            <h1 className="text-xl font-bold text-gray-900">No sponsorship access</h1>
            <p className="text-gray-500 text-sm mt-1">This area is for M3 staff, Yacht Club de Monaco, and linked sponsors.</p>
          </div>
        )}
        {role === 'manager' && (
          <Routes>
            <Route index element={<SponsorshipHub basePath="/sponsorship" />} />
            <Route path=":sponsorId" element={<SponsorAgreementDetail basePath="/sponsorship" />} />
          </Routes>
        )}
        {role === 'sponsor' && <SponsorPortal sponsorIds={sponsorIds} />}
      </div>
    </div>
  );
}
