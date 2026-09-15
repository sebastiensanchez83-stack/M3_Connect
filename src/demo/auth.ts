// Fake GoTrue. The demo lands signed in as the fictional marina owner; signing
// out works, and signing back in accepts any email and password, so a designer
// can film the login screen too.
import { DEMO_USER } from './identity';

const SIGNED_OUT_KEY = 'sm-demo-signed-out';
const FAR_FUTURE = 4102444800; // 2100-01-01

const b64url = (o: unknown) =>
  btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

export function demoUser() {
  const created = '2026-04-16T09:08:44.000Z';
  return {
    id: DEMO_USER.id,
    aud: 'authenticated',
    role: 'authenticated',
    email: DEMO_USER.email,
    email_confirmed_at: created,
    phone: '',
    confirmed_at: created,
    last_sign_in_at: new Date().toISOString(),
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: { first_name: DEMO_USER.first_name, last_name: DEMO_USER.last_name, email_verified: true },
    identities: [],
    created_at: created,
    updated_at: created,
    is_anonymous: false,
  };
}

export function demoSession() {
  const iat = Math.floor(Date.now() / 1000);
  const access_token = [
    b64url({ alg: 'HS256', typ: 'JWT' }),
    b64url({ sub: DEMO_USER.id, email: DEMO_USER.email, role: 'authenticated', aud: 'authenticated', exp: FAR_FUTURE, iat, session_id: 'demo-session' }),
    'demo-signature',
  ].join('.');
  return {
    access_token,
    token_type: 'bearer',
    expires_in: FAR_FUTURE - iat,
    expires_at: FAR_FUTURE,
    refresh_token: 'demo-refresh-token',
    user: demoUser(),
  };
}

// Written before the Supabase client is created, so INITIAL_SESSION already
// carries the demo session and protected pages never flash the login screen.
export function seedSession(storageKey: string) {
  try {
    if (localStorage.getItem(SIGNED_OUT_KEY)) return;
    if (!localStorage.getItem(storageKey)) localStorage.setItem(storageKey, JSON.stringify(demoSession()));
  } catch { /* storage unavailable: the login screen still works */ }
}

export function handleAuth(method: string, path: string, params: URLSearchParams): { status: number; body: any } {
  if (path === 'token') {
    try { localStorage.removeItem(SIGNED_OUT_KEY); } catch { /* ignore */ }
    return { status: 200, body: demoSession() };
  }
  if (path === 'user') return { status: 200, body: demoUser() };
  if (path === 'logout') {
    try { localStorage.setItem(SIGNED_OUT_KEY, '1'); } catch { /* ignore */ }
    return { status: 204, body: null };
  }
  if (path === 'signup' || path === 'verify') return { status: 200, body: demoSession() };
  if (path === 'settings') return { status: 200, body: { external: { email: true }, disable_signup: false, mailer_autoconfirm: true } };
  if (path.startsWith('factors')) return { status: 200, body: [] };
  // recover, otp, resend, reauthenticate: pretend the email went out
  void method; void params;
  return { status: 200, body: {} };
}
