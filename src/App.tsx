import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Navbar } from '@/components/layout/Navbar';
import { Footer } from '@/components/layout/Footer';
import { AuthRedirector } from '@/components/auth/AuthRedirector';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { CookieBanner } from '@/components/layout/CookieBanner';
import { captureInviteFromUrl } from '@/lib/invite-store';
import { RefreshCw } from 'lucide-react';

// Capture ?invite= param on initial page load (before React renders)
captureInviteFromUrl();

// Eagerly loaded pages (visible on first paint / SEO critical)
import { HomePage } from '@/pages/HomePage';
import { ResourcesPage } from '@/pages/ResourcesPage';
import { ResourceDetailPage } from '@/pages/ResourceDetailPage';
import { EventsPage } from '@/pages/EventsPage';
import { EventDetailPage } from '@/pages/EventDetailPage';
import { PartnersPage } from '@/pages/PartnersPage';
import { NotFoundPage } from '@/pages/NotFoundPage';

// Lazy loaded pages (behind auth or lower traffic)
const AccountPage = lazy(() => import('@/pages/AccountPage').then(m => ({ default: m.AccountPage })));
const OnboardingPage = lazy(() => import('@/pages/OnboardingPage').then(m => ({ default: m.OnboardingPage })));
const AdminPage = lazy(() => import('@/pages/AdminPage').then(m => ({ default: m.AdminPage })));
const MarketplacePage = lazy(() => import('@/pages/MarketplacePage').then(m => ({ default: m.MarketplacePage })));
const OrganizationPublicPage = lazy(() => import('@/pages/OrganizationPublicPage').then(m => ({ default: m.OrganizationPublicPage })));
const UserProfilePage = lazy(() => import('@/pages/UserProfilePage').then(m => ({ default: m.UserProfilePage })));
const SubmitProjectPage = lazy(() => import('@/pages/SubmitProjectPage').then(m => ({ default: m.SubmitProjectPage })));
const SubmitRFPPage = lazy(() => import('@/pages/SubmitRFPPage').then(m => ({ default: m.SubmitRFPPage })));
const SubmitConsultationPage = lazy(() => import('@/pages/SubmitConsultationPage').then(m => ({ default: m.SubmitConsultationPage })));
const WebinarRequestPage = lazy(() => import('@/pages/WebinarRequestPage').then(m => ({ default: m.WebinarRequestPage })));
const BecomePartnerPage = lazy(() => import('@/pages/BecomePartnerPage').then(m => ({ default: m.BecomePartnerPage })));
const TiersPage = lazy(() => import('@/pages/TiersPage').then(m => ({ default: m.TiersPage })));
const JoinPage = lazy(() => import('@/pages/JoinPage').then(m => ({ default: m.JoinPage })));
const ResetPasswordPage = lazy(() => import('@/pages/ResetPasswordPage').then(m => ({ default: m.ResetPasswordPage })));
const AboutPage = lazy(() => import('@/pages/AboutPage').then(m => ({ default: m.AboutPage })));
const ContactPage = lazy(() => import('@/pages/ContactPage').then(m => ({ default: m.ContactPage })));
const PrivacyPage = lazy(() => import('@/pages/PrivacyPage').then(m => ({ default: m.PrivacyPage })));
const TermsPage = lazy(() => import('@/pages/TermsPage').then(m => ({ default: m.TermsPage })));
const MentionsLegalesPage = lazy(() => import('@/pages/MentionsLegalesPage').then(m => ({ default: m.MentionsLegalesPage })));
const ConditionsCommercialesPage = lazy(() => import('@/pages/ConditionsCommercialesPage').then(m => ({ default: m.ConditionsCommercialesPage })));
const CookiePolicyPage = lazy(() => import('@/pages/CookiePolicyPage').then(m => ({ default: m.CookiePolicyPage })));

function LazyFallback() {
  return (
    <div className="flex items-center justify-center h-[60vh]">
      <RefreshCw className="h-8 w-8 animate-spin text-primary" />
    </div>
  );
}

function App() {
  return (
    <div className="min-h-screen flex flex-col overflow-x-hidden">
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
          <Suspense fallback={<LazyFallback />}>
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
              <Route path="/join/:inviteId" element={<JoinPage />} />
              <Route path="/reset-password" element={<ResetPasswordPage />} />
              <Route path="/about" element={<AboutPage />} />
              <Route path="/contact" element={<ContactPage />} />
              <Route path="/privacy" element={<PrivacyPage />} />
              <Route path="/terms" element={<TermsPage />} />
              <Route path="/mentions-legales" element={<MentionsLegalesPage />} />
              <Route path="/conditions-commerciales" element={<ConditionsCommercialesPage />} />
              <Route path="/cgv" element={<Navigate to="/conditions-commerciales" replace />} />
              <Route path="/cookies" element={<CookiePolicyPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </Suspense>
        </ErrorBoundary>
      </main>
      <Footer />
      <CookieBanner />
    </div>
  );
}

export default App;
