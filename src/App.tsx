import { Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Navbar } from '@/components/layout/Navbar';
import { Footer } from '@/components/layout/Footer';
import { AuthRedirector } from '@/components/auth/AuthRedirector';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { CookieBanner } from '@/components/layout/CookieBanner';
import { captureInviteFromUrl } from '@/lib/invite-store';
import { lazyWithRetry } from '@/lib/lazyWithRetry';
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

// Lazy loaded pages (behind auth or lower traffic).
// lazyWithRetry auto-recovers from stale-chunk errors after a new deploy.
const AccountPage = lazyWithRetry(() => import('@/pages/AccountPage').then(m => ({ default: m.AccountPage })));
const OnboardingPage = lazyWithRetry(() => import('@/pages/OnboardingPage').then(m => ({ default: m.OnboardingPage })));
const AdminPage = lazyWithRetry(() => import('@/pages/AdminPage').then(m => ({ default: m.AdminPage })));
const MarketplacePage = lazyWithRetry(() => import('@/pages/MarketplacePage').then(m => ({ default: m.MarketplacePage })));
const OrganizationPublicPage = lazyWithRetry(() => import('@/pages/OrganizationPublicPage').then(m => ({ default: m.OrganizationPublicPage })));
const UserProfilePage = lazyWithRetry(() => import('@/pages/UserProfilePage').then(m => ({ default: m.UserProfilePage })));
const SubmitProjectPage = lazyWithRetry(() => import('@/pages/SubmitProjectPage').then(m => ({ default: m.SubmitProjectPage })));
const SubmitRFPPage = lazyWithRetry(() => import('@/pages/SubmitRFPPage').then(m => ({ default: m.SubmitRFPPage })));
const SubmitConsultationPage = lazyWithRetry(() => import('@/pages/SubmitConsultationPage').then(m => ({ default: m.SubmitConsultationPage })));
const WebinarRequestPage = lazyWithRetry(() => import('@/pages/WebinarRequestPage').then(m => ({ default: m.WebinarRequestPage })));
const BecomePartnerPage = lazyWithRetry(() => import('@/pages/BecomePartnerPage').then(m => ({ default: m.BecomePartnerPage })));
const TiersPage = lazyWithRetry(() => import('@/pages/TiersPage').then(m => ({ default: m.TiersPage })));
const JoinPage = lazyWithRetry(() => import('@/pages/JoinPage').then(m => ({ default: m.JoinPage })));
const ResetPasswordPage = lazyWithRetry(() => import('@/pages/ResetPasswordPage').then(m => ({ default: m.ResetPasswordPage })));
const ReferenceConfirmPage = lazyWithRetry(() => import('@/pages/ReferenceConfirmPage').then(m => ({ default: m.ReferenceConfirmPage })));
const ReferenceRejectPage = lazyWithRetry(() => import('@/pages/ReferenceRejectPage').then(m => ({ default: m.ReferenceRejectPage })));
const AboutPage = lazyWithRetry(() => import('@/pages/AboutPage').then(m => ({ default: m.AboutPage })));
const ContactPage = lazyWithRetry(() => import('@/pages/ContactPage').then(m => ({ default: m.ContactPage })));
const PrivacyPage = lazyWithRetry(() => import('@/pages/PrivacyPage').then(m => ({ default: m.PrivacyPage })));
const TermsPage = lazyWithRetry(() => import('@/pages/TermsPage').then(m => ({ default: m.TermsPage })));
const MentionsLegalesPage = lazyWithRetry(() => import('@/pages/MentionsLegalesPage').then(m => ({ default: m.MentionsLegalesPage })));
const ConditionsCommercialesPage = lazyWithRetry(() => import('@/pages/ConditionsCommercialesPage').then(m => ({ default: m.ConditionsCommercialesPage })));
const CookiePolicyPage = lazyWithRetry(() => import('@/pages/CookiePolicyPage').then(m => ({ default: m.CookiePolicyPage })));

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
              <Route path="/submit-project" element={<ProtectedRoute requireVerified requirePersona={['marina']} bypassEntitlement="submit_project" showLocked lockedMessage="Only verified marina organizations can submit projects."><SubmitProjectPage /></ProtectedRoute>} />
              <Route path="/submit-project/:id" element={<ProtectedRoute requireVerified requirePersona={['marina']} bypassEntitlement="submit_project" showLocked lockedMessage="Only verified marina organizations can submit projects."><SubmitProjectPage /></ProtectedRoute>} />
              <Route path="/request-webinar" element={<ProtectedRoute requireVerified showLocked lockedMessage="Your account must be verified to request a webinar."><WebinarRequestPage /></ProtectedRoute>} />
              <Route path="/submit-rfp" element={<ProtectedRoute requireVerified requirePersona={['marina']} bypassEntitlement="submit_rfp" showLocked lockedMessage="Only verified marina organizations can submit RFPs."><SubmitRFPPage /></ProtectedRoute>} />
              <Route path="/submit-rfp/:id" element={<ProtectedRoute requireVerified requirePersona={['marina']} bypassEntitlement="submit_rfp" showLocked lockedMessage="Only verified marina organizations can submit RFPs."><SubmitRFPPage /></ProtectedRoute>} />
              <Route path="/submit-consultation" element={<ProtectedRoute requireVerified requirePersona={['marina']} bypassEntitlement="submit_consultation" showLocked lockedMessage="Only verified marina organizations can submit consultation requests."><SubmitConsultationPage /></ProtectedRoute>} />
              <Route path="/submit-consultation/:id" element={<ProtectedRoute requireVerified requirePersona={['marina']} bypassEntitlement="submit_consultation" showLocked lockedMessage="Only verified marina organizations can submit consultation requests."><SubmitConsultationPage /></ProtectedRoute>} />
              <Route path="/network" element={<MarketplacePage />} />
              <Route path="/marketplace" element={<Navigate to="/network" replace />} />
              <Route path="/organizations/:slug" element={<OrganizationPublicPage />} />
              <Route path="/users/:id" element={<UserProfilePage />} />
              <Route path="/admin/*" element={<ProtectedRoute requireModerator><AdminPage /></ProtectedRoute>} />
              <Route path="/join" element={<Navigate to="/become-partner" replace />} />
              <Route path="/join/:inviteId" element={<JoinPage />} />
              <Route path="/reset-password" element={<ResetPasswordPage />} />
              <Route path="/reference/confirm" element={<ReferenceConfirmPage />} />
              <Route path="/reference/reject" element={<ReferenceRejectPage />} />
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
