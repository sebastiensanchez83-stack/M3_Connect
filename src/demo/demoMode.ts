// The `demo` branch exists only to film the platform for adverts. It is never
// merged into main. Every request the app makes is answered in the browser from
// fictional data (see src/demo/fetch.ts), so nothing a designer clicks can reach
// the live platform, the event admin or anyone's inbox.
//
// The host check keeps a mistaken merge harmless: on the production hosts the
// app talks to the real backend exactly as before.
const PRODUCTION_HOSTS = ['smartmarinaconnect.com', 'www.smartmarinaconnect.com', 'm3connect.netlify.app'];

export const DEMO_MODE: boolean =
  typeof window !== 'undefined' && !PRODUCTION_HOSTS.includes(window.location.hostname);

// The fake backend lives under the site's own origin. A request the demo layer
// fails to intercept therefore lands on this static site, never on Supabase.
export const DEMO_API_BASE: string =
  typeof window !== 'undefined' ? `${window.location.origin}/__demo` : 'http://localhost/__demo';
