import { Routes, Route, Navigate } from 'react-router-dom';
import { Navbar } from '@/components/layout/Navbar';
import { Footer } from '@/components/layout/Footer';
import { AuthRedirector } from '@/components/auth/AuthRedirector';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { CookieBanner } from '@/components/layout/CookieBanner';
import { HomePage } from '@/pages/HomePage';
import { ResourcesPage } from '@/pages/ResourcesPage';
import { ResourceDetailPage } from '@/pages/ResourceDetailPage';
import { EventsPage } from '@/pages/EventsPage';
import { EventDetailPage } from '@/pages/EventDetailPage';
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
import { OrganizationPublicPage } from '@/pages/OrganizationPublicPage';
import { UserProfilePage } from '@/pages/UserProfilePage';
import { AboutPage } from '@/pages/AboutPage';
import { ContactPage } from '@/pages/ContactPage';
import { PrivacyPage } from '@/pages/PrivacyPage';
import { TermsPage } from '@/pages/TermsPage';
import { MentionsLegalesPage } from '@/pages/MentionsLegalesPage';
import { ConditionsCommercialesPage } from '@/pages/ConditionsCommercialesPage';
import { CookiePolicyPage } from '@/pages/CookiePolicyPage';
import { TiersPage } from '@/pages/TiersPage';
import { NotFoundPage } from '@/pages/NotFoundPage';

function App() {
  return (
    <div className="min-h-screen flex flex-col">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:z-[200] focus:top-4 focus:left-4 focus:bg-white focus:px-4 focus:py-2 focus:rounded-lg focus:shadow-lg focus:text-primary focus:font-medium focus:outline-none focus:ring-2 focus:ring-primary"
      >
        Skip to main content
      </a>
      <Navbar />
      <AuthRedirector />
      <main id="main-content" className="flex-1">
        <ErrorBoundary>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/resources" element={<ResourcesPage />} />
            <Route path="/resources/:id" element={<ResourceDetailPage />} />
            <Route path="/events" element={<EventsPage />} />
            <Route path="/events/:id" element={<EventDetailPage />} />
            <Route path="/partners" element={<PartnersPage />} />
            <Route path="/become-partner" element={<BecomePartnerPage />} />
            <Route path="/tiers" element={<TiersPage />} />
            <Route path="/account" element={<ProtectedRoute><AccountPage /></ProtectedRoute>} />
            <Route path="/onboarding" element={<ProtectedRoute><OnboardingPage /></ProtectedRoute>} />
            <Route path="/submit-project" element={<ProtectedRoute requireVerified requirePersona={['marina']} showLocked lockedMessage="Only verified marina organizations can submit projects."><SubmitProjectPage /></ProtectedRoute>} />
            <Route path="/submit-project/:id" element={<ProtectedRoute requireVerified requirePersona={['marina']} showLocked lockedMessage="Only verified marina organizations can submit projects."><SubmitProjectPage /></ProtectedRoute>} />
            <Route path="/request-webinar" element={<ProtectedRoute requireVerified showLocked lockedMessage="Your account must be verified to request a webinar."><WebinarRequestPage /></ProtectedRoute>} />
            <Route path="/submit-rfp" element={<ProtectedRoute requireVerified requirePersona={['marina']} showLocked lockedMessage="Only verified marina organizations can submit RFPs."><SubmitRFPPage /></ProtectedRoute>} />
            <Route path="/submit-rfp/:id" element={<ProtectedRoute requireVerified requirePersona={['marina']} showLocked lockedMessage="Only verified marina organizations can submit RFPs."><SubmitRFPPage /></ProtectedRoute>} />
            <Route path="/submit-consultation" element={<ProtectedRoute requireVerified requirePersona={['marina']} showLocked lockedMessage="Only verified marina organizations can submit consultation requests."><SubmitConsultationPage /></ProtectedRoute>} />
            <Route path="/submit-consultation/:id" element={<ProtectedRoute requireVerified requirePersona={['marina']} showLocked lockedMessage="Only verified marina organizations can submit consultation requests."><SubmitConsultationPage /></ProtectedRoute>} />
            <Route path="/network" element={<MarketplacePage />} />
            <Route path="/marketplace" element={<Navigate to="/network" replace />} />
            <Route path="/organizations/:slug" element={<OrganizationPublicPage />} />
            <Route path="/users/:id" element={<UserProfilePage />} />
            <Route path="/admin/*" element={<ProtectedRoute requireModerator><AdminPage /></ProtectedRoute>} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route path="/about" element={<AboutPage />} />
            <Route path="/contact" element={<ContactPage />} />
            <Route path="/privacy" element={<PrivacyPage />} />
            <Route path="/terms" element={<TermsPage />} />
            <Route path="/mentions-legales" element={<MentionsLegalesPage />} />
            <Route path="/conditions-commerciales" element={<ConditionsCommercialesPage />} />
            <Route path="/cookies" element={<CookiePolicyPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </ErrorBoundary>
      </main>
      <Footer />
      <CookieBanner />
    </div>
  );
}

export default App;
