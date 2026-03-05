import { Routes, Route } from 'react-router-dom';
import { Navbar } from '@/components/layout/Navbar';
import { Footer } from '@/components/layout/Footer';
import { HomePage } from '@/pages/HomePage';
import { ResourcesPage } from '@/pages/ResourcesPage';
import { ResourceDetailPage } from '@/pages/ResourceDetailPage';
import { EventsPage } from '@/pages/EventsPage';
import { PartnersPage } from '@/pages/PartnersPage';
import { BecomePartnerPage } from '@/pages/BecomePartnerPage';
import { AccountPage } from '@/pages/AccountPage';
import { OnboardingPage } from '@/pages/OnboardingPage';
import { SubmitProjectPage } from '@/pages/SubmitProjectPage';
import { AdminPage } from '@/pages/AdminPage';
import { WebinarRequestPage } from '@/pages/WebinarRequestPage';
import { SubmitRFPPage } from '@/pages/SubmitRFPPage';
import { SubmitConsultationPage } from '@/pages/SubmitConsultationPage';
import { MarketplacePage } from '@/pages/MarketplacePage';
import { ResetPasswordPage } from '@/pages/ResetPasswordPage';

function App() {
  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/resources" element={<ResourcesPage />} />
          <Route path="/resources/:id" element={<ResourceDetailPage />} />
          <Route path="/events" element={<EventsPage />} />
          <Route path="/partners" element={<PartnersPage />} />
          <Route path="/become-partner" element={<BecomePartnerPage />} />
          <Route path="/account" element={<AccountPage />} />
          <Route path="/onboarding" element={<OnboardingPage />} />
          <Route path="/submit-project" element={<SubmitProjectPage />} />
          <Route path="/request-webinar" element={<WebinarRequestPage />} />
          <Route path="/submit-rfp" element={<SubmitRFPPage />} />
          <Route path="/submit-consultation" element={<SubmitConsultationPage />} />
          <Route path="/marketplace" element={<MarketplacePage />} />
          <Route path="/admin/*" element={<AdminPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
        </Routes>
      </main>
      <Footer />
    </div>
  );
}

export default App;
