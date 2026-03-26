import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { HelmetProvider } from 'react-helmet-async'
import App from './App'
import { AuthProvider } from './contexts/AuthContext'
import { Toaster } from './components/ui/toaster'
import './i18n'
import './index.css'

// StrictMode removed: it causes double mount/unmount/remount in dev,
// which triggers a Web Lock deadlock in @supabase/gotrue-js.
// The auth subscription is now at module level (supabase.ts) to prevent
// lock contention, but StrictMode can still cause other gotrue-js
// internal state issues. Safe to re-enable once Supabase is upgraded.
ReactDOM.createRoot(document.getElementById('root')!).render(
  <HelmetProvider>
    <BrowserRouter>
      <AuthProvider>
        <App />
        <Toaster />
      </AuthProvider>
    </BrowserRouter>
  </HelmetProvider>,
)
