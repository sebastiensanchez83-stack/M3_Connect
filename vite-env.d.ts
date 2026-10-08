/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly  VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  /** Cloudflare Turnstile site key (public). Unset: no anti-spam widget, no token sent. */
  readonly VITE_TURNSTILE_SITE_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
