import { useEffect } from 'react';
import { Routes, Route, useNavigate } from 'react-router-dom';
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

  useEffect(() => {
    // Listen for password recovery event
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        navigate('/reset-password');
      }
    });

    // Check URL hash for recovery token on initial load
    const hashParams = new URLSearchParams(window.location.hash.substring(1));
    const type = hashParams.get('type');
    if (type === 'recovery') {
      navigate('/reset-password');
    }

    return () => subscription.unsubscribe();
  }, [navigate]);

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
