import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
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
