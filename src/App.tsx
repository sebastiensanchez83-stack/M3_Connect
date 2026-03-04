import { BrowserRouter, Routes, Route } from 'react-router-dom'

import { AuthProvider } from '@/contexts/AuthContext'
import { AuthRedirector } from '@/components/auth/AuthRedirector'

// Pages (adjust import paths if your filenames differ)
import HomePage from '@/pages/HomePage'
import AuthPage from '@/pages/AuthPage'
import AccountPage from '@/pages/AccountPage'
import OnboardingPage from '@/pages/OnboardingPage'
import AdminPage from '@/pages/AdminPage'
import ResetPasswordPage from '@/pages/ResetPasswordPage'

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        {/* Global redirect logic lives here */}
        <AuthRedirector />

        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/auth" element={<AuthPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />

          <Route path="/account" element={<AccountPage />} />
          <Route path="/onboarding" element={<OnboardingPage />} />
          <Route path="/admin" element={<AdminPage />} />

          {/* Fallback */}
          <Route path="*" element={<HomePage />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
