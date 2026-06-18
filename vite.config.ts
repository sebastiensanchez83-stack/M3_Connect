import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import os from 'node:os'

export default defineConfig({
  // Keep Vite's dependency-optimization cache OUT of the Dropbox-synced
  // node_modules/.vite folder to avoid EBUSY file-lock errors during dev.
  cacheDir: path.join(os.tmpdir(), 'vite-m3connect'),
  plugins: [react()],
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
