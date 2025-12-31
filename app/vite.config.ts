import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { TanStackRouterVite } from '@tanstack/router-plugin/vite'
import path from 'node:path'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [TanStackRouterVite(), react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    define: {
      JAN_API_BASE_URL: JSON.stringify(env.JAN_API_BASE_URL),
      VITE_GA_ID: JSON.stringify(env.VITE_GA_ID),
      VITE_AUTH_URL: JSON.stringify(
        env.VITE_AUTH_URL || 'https://auth-dev.jan.ai'
      ),
      VITE_AUTH_REALM: JSON.stringify(env.VITE_AUTH_REALM || 'jan'),
      VITE_AUTH_CLIENT_ID: JSON.stringify(
        env.VITE_AUTH_CLIENT_ID || 'jan-client'
      ),
      VITE_OAUTH_REDIRECT_URI: JSON.stringify(
        env.VITE_OAUTH_REDIRECT_URI || 'http://localhost:3001/auth/callback'
      ),
      VITE_REPORT_ISSUE_URL: JSON.stringify(env.VITE_REPORT_ISSUE_URL || '/'),
      BROWSER_SERVER_NAME: JSON.stringify('Jan Browser Extension'),
      EXTENSION_ID: JSON.stringify(
        env.EXTENSION_ID || 'mkciifcjehgnpaigoiaakdgabbpfppal'
      ),
      CHROME_STORE_URL: JSON.stringify(
        env.CHROME_STORE_URL ||
          'https://chromewebstore.google.com/detail/jan-browser-mcp/mkciifcjehgnpaigoiaakdgabbpfppal'
      ),
    },
  }
})
