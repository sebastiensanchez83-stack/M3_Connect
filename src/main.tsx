import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { HelmetProvider } from 'react-helmet-async'
import App from './App'
import { AuthProvider } from './contexts/AuthContext'
import { Toaster } from './components/ui/toaster'
import { MotionProvider } from './components/motion/MotionProvider'
import './i18n'
// Inter, self-hosted (variable weight axis, font-display: swap): the UI font.
import '@fontsource-variable/inter'
// Barlow Semi Condensed 500/600, latin only: the harbour-signage voice (font-signage).
import '@fontsource/barlow-semi-condensed/latin-500.css'
import '@fontsource/barlow-semi-condensed/latin-600.css'
import './index.css'
// Motion layer and brand devices: after index.css so it wins over utilities.
import './styles/smc-motion.css'

// StrictMode removed: it causes double mount/unmount/remount in dev,
// which triggers a Web Lock deadlock in @supabase/gotrue-js.
// The auth subscription is now at module level (supabase.ts) to prevent
// lock contention, but StrictMode can still cause other gotrue-js
// internal state issues. Safe to re-enable once Supabase is upgraded.
ReactDOM.createRoot(document.getElementById('root')!).render(
  <HelmetProvider>
    <BrowserRouter>
      <AuthProvider>
        <MotionProvider>
          <App />
          <Toaster />
        </MotionProvider>
      </AuthProvider>
    </BrowserRouter>
  </HelmetProvider>,
)
