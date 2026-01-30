import { useEffect, useState } from 'react';
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { Navbar } from '@/components/layout/Navbar';
import { Footer } from '@/components/layout/Footer';
import { HomePage } from '@/pages/HomePage';
import { ResourcesPage } from '@/pages/ResourcesPage';
import { EventsPage } from '@/pages/EventsPage';
import { PartnersPage } from '@/pages/PartnersPage';
import { BecomePartnerPage } from '@/pages/BecomePartnerPage';
import { AccountPage } from '@/pages/AccountPage';
import { SubmitProjectPage } from '@/pages/SubmitProjectPage';
import { AdminPage } from '@/pages/AdminPage';
import { ResetPasswordPage } from '@/pages/ResetPasswordPage';
import { supabase } from '@/lib/supabase';

function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    // Check URL hash immediately on load (before Supabase consumes it)
    const hash = window.location.hash;
    if (hash && hash.includes('type=recovery')) {
      navigate('/reset-password');
      setIsReady(true);
      return;
    }

    // Check URL params (some Supabase configs use query params)
    const params = new URLSearchParams(window.location.search);
    if (params.get('type') === 'recovery') {
      navigate('/reset-password');
      setIsReady(true);
      return;
    }

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        navigate('/reset-password');
      }
    });

    setIsReady(true);

    return () => subscription.unsubscribe();
  }, [navigate]);

  if (!isReady) {
    return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/resources" element={<ResourcesPage />} />
          <Route path="/events" element={<EventsPage />} />
          <Route path="/partners" element={<PartnersPage />} />
          <Route path="/become-partner" element={<BecomePartnerPage />} />
          <Route path="/account" element={<AccountPage />} />
          <Route path="/submit-project" element={<SubmitProjectPage />} />
          <Route path="/admin/*" element={<AdminPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
        </Routes>
      </main>
      <Footer />
    </div>
  );
}

export default App;
