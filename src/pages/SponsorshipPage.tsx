import { useState, useEffect, useCallback } from 'react';
import { Link, Routes, Route } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { AlertCircle, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CardShell } from '@/components/brand/CardShell';
import { BTN_OUTLINE, MemberEmpty, RowSkeleton } from '@/components/member/MemberUI';
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
    <div className="min-h-screen bg-page">
      <Helmet><title>Sponsorship — Smart Marina Connect</title></Helmet>

      {role === 'loading' && (
        <div className="mx-auto max-w-3xl px-4 py-16" role="status" aria-label="Loading">
          <CardShell><RowSkeleton rows={3} /></CardShell>
        </div>
      )}

      {role === 'error' && (
        <div className="mx-auto max-w-xl px-4 py-16 sm:py-24">
          <CardShell>
            <MemberEmpty
              titleAs="h1"
              tone="warning"
              icon={AlertCircle}
              title="Couldn't check your access"
              body="Something went wrong loading the sponsorship area."
              action={<Button variant="ctaNavy" size="sm" onClick={resolve}>Try again</Button>}
            />
          </CardShell>
        </div>
      )}

      {role === 'none' && (
        <div className="mx-auto max-w-xl px-4 py-16 sm:py-24">
          <CardShell>
            <MemberEmpty
              titleAs="h1"
              icon={Lock}
              title="No sponsorship access"
              body="This area is for M3 staff, Yacht Club de Monaco, and linked sponsors."
              action={(
                <Button asChild variant="outline" className={BTN_OUTLINE}>
                  <Link to="/#dashboard">Back to my dashboard</Link>
                </Button>
              )}
            />
          </CardShell>
        </div>
      )}

      {role === 'manager' && (
        <Routes>
          <Route index element={<SponsorshipHub basePath="/sponsorship" band />} />
          <Route path=":sponsorId" element={<SponsorAgreementDetail basePath="/sponsorship" band />} />
        </Routes>
      )}

      {role === 'sponsor' && <SponsorPortal sponsorIds={sponsorIds} band />}
    </div>
  );
}
