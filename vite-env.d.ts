/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly  VITE_SUPABASE_URL: 'https://djjbgzasuomhyfvtlidi.supabase.co'
  readonly VITE_SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRqamJnemFzdW9taHlmdnRsaWRpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk2MTQzODUsImV4cCI6MjA4NTE5MDM4NX0.7HiGbBFq-yR37z7F3gvqeZ71emvHKR-dR05HrAORbWA'
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
