import { useState, useEffect, useCallback } from 'react';
import { Routes, Route } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { RefreshCw, Lock, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { SponsorshipHub } from '@/components/sponsorship/SponsorshipHub';
import { SponsorAgreementDetail } from '@/components/sponsorship/SponsorAgreementDetail';
import { SponsorPortal } from '@/components/sponsorship/SponsorPortal';

// Top-level sponsorship surface. Managers (M3 admin/moderator OR Yacht Club de
// Monaco) get the full fulfilment hub; a linked sponsor gets their own portal.
// Access is enforced by RLS; this only picks which view to render.

type Role = 'loading' | 'manager' | 'sponsor' | 'none' | 'error';

export function SponsorshipPage() {
  const { user, loading: authLoading } = useAuth();
  const [role, setRole] = useState<Role>('loading');
  const [sponsorIds, setSponsorIds] = useState<string[]>([]);

  const resolve = useCallback(async () => {
    if (!user) { setRole('none'); return; }
    setRole('loading');
    // A failed manager check must NOT silently downgrade a real manager to the
    // no-access screen — surface an error with a retry instead.
    const { data: mgr, error: mgrErr } = await supabase.rpc('is_sponsorship_manager');
    if (mgrErr) { setRole('error'); return; }
    if (mgr === true) { setRole('manager'); return; }
    const { data: su, error: suErr } = await supabase.from('sp_sponsor_user').select('sponsor_id').eq('user_id', user.id);
    if (suErr) { setRole('error'); return; }
    const ids = ((su || []) as { sponsor_id: string }[]).map(x => x.sponsor_id);
    if (ids.length) { setSponsorIds(ids); setRole('sponsor'); } else setRole('none');
  }, [user]);

  useEffect(() => { if (!authLoading) resolve(); }, [authLoading, resolve]);

  return (
    <div className="min-h-screen bg-gray-50">
      <Helmet><title>Sponsorship — Smart Marina Connect</title></Helmet>
      <div className="container mx-auto px-4 py-8">
        {role === 'loading' && <div className="flex items-center justify-center h-[50vh]"><RefreshCw className="h-8 w-8 animate-spin text-primary" /></div>}
        {role === 'error' && (
          <div className="max-w-md mx-auto py-16 text-center">
            <AlertCircle className="h-10 w-10 text-amber-400 mx-auto mb-3" />
            <h1 className="text-xl font-bold text-gray-900">Couldn't check your access</h1>
            <p className="text-gray-500 text-sm mt-1 mb-4">Something went wrong loading the sponsorship area.</p>
            <Button onClick={resolve}>Try again</Button>
          </div>
        )}
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
