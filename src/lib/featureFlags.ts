// Build-time feature flags.
//
// SM26 (the Smart & Sustainable Marina Rendezvous 2026 event module) is built on
// the `sm26` branch. This flag lets the code merge to `main` WITHOUT exposing the
// public /sm26/* participant routes on production until M3 is ready to launch.
//
// - Local dev (`import.meta.env.DEV`): always ON, so the team can build/test.
// - Production build: OFF unless `VITE_SM26_ENABLED=true` is set in the build
//   environment (e.g. Netlify env var). Flip it + redeploy to go live.
//
// Note: this gates the PUBLIC participant surfaces only. The admin console
// (/admin/sm26/*) stays available to staff (it's already behind requireModerator)
// so M3 can prepare the event before the public launch.
export const SM26_ENABLED: boolean =
  import.meta.env.DEV || import.meta.env.VITE_SM26_ENABLED === 'true';
