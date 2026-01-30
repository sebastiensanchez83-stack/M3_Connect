import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { AuthProvider } from './contexts/AuthContext'
import { Toaster } from './components/ui/toaster'
import './i18n'
import './index.css'

// Capture hash BEFORE React mounts (Supabase clears it)
const hash = window.location.hash;
if (hash && hash.includes('type=recovery')) {
  sessionStorage.setItem('passwordRecovery', 'true');
  if (!window.location.pathname.includes('reset-password')) {
    window.location.href = '/reset-password' + hash;
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
        <Toaster />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
)
