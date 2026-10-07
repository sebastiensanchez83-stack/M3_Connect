import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import os from 'node:os'
import { SEO_STRINGS } from './src/i18n/seo'

/**
 * index.html carries the default title and description, for the share robots
 * and crawlers that never run JavaScript. They come from the same i18n keys as
 * the home page (seo.home, English), filled in at build time so the two never
 * drift apart: edit src/i18n/seo.ts, not index.html.
 */
function seoDefaults(): Plugin {
  const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const { title, description } = SEO_STRINGS.en.seo.home
  const { shareImageAlt } = SEO_STRINGS.en.seo
  return {
    name: 'smc-seo-defaults',
    transformIndexHtml: {
      order: 'pre',
      // Replacement functions, not strings: a "$" in the words must stay a "$".
      handler: (html) => html
        // Inside the JSON-LD script: JSON escaping, not HTML entities.
        .replace(/__SEO_HOME_DESCRIPTION_JSON__/g, () => JSON.stringify(description).slice(1, -1).replace(/</g, '\\u003c'))
        .replace(/__SEO_HOME_TITLE__/g, () => escape(title))
        .replace(/__SEO_HOME_DESCRIPTION__/g, () => escape(description))
        .replace(/__SEO_SHARE_IMAGE_ALT__/g, () => escape(shareImageAlt)),
    },
  }
}

export default defineConfig({
  // Keep Vite's dependency-optimization cache OUT of the Dropbox-synced
  // node_modules/.vite folder to avoid EBUSY file-lock errors during dev.
  cacheDir: path.join(os.tmpdir(), 'vite-m3connect'),
  plugins: [seoDefaults(), react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-supabase': ['@supabase/supabase-js'],
          'vendor-ui': [
            '@radix-ui/react-dialog', '@radix-ui/react-select', '@radix-ui/react-tabs',
            '@radix-ui/react-accordion', '@radix-ui/react-dropdown-menu', '@radix-ui/react-checkbox',
            '@radix-ui/react-toast', '@radix-ui/react-avatar',
          ],
          'vendor-icons': ['lucide-react'],
          'vendor-i18n': ['react-i18next', 'i18next'],
        },
      },
    },
  },
})
