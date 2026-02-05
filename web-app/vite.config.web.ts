import { defineConfig, Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import { TanStackRouterVite } from '@tanstack/router-plugin/vite'

// Plugin to inject GA scripts in HTML
function injectGoogleAnalytics(): Plugin {
  return {
    name: 'inject-google-analytics',
    transformIndexHtml(html) {
      const gaMeasurementId = process.env.GA_MEASUREMENT_ID

      // Only inject GA scripts if GA_MEASUREMENT_ID is set
      if (!gaMeasurementId) {
        // Remove placeholder if no GA ID
        return html.replace(/\s*<!-- INJECT_GOOGLE_ANALYTICS -->\n?/g, '')
      }

      const gaScripts = `<!-- Google Analytics -->
    <script async src="https://www.googletagmanager.com/gtag/js?id=${gaMeasurementId}"></script>
    <script>
      window.dataLayer = window.dataLayer || [];
      function gtag(){ dataLayer.push(arguments); }
      gtag('consent','default',{
        ad_storage:'denied',
        analytics_storage:'denied',
        ad_user_data:'denied',
        ad_personalization:'denied',
        wait_for_update:500
      });
      gtag('js', new Date());
      gtag('config', '${gaMeasurementId}', {
        debug_mode: (location.hostname === 'localhost'),
        send_page_view: false
      });
    </script>`

      return html.replace('<!-- INJECT_GOOGLE_ANALYTICS -->', gaScripts)
    },
  }
}

export default defineConfig({
  plugins: [
    TanStackRouterVite({
      target: 'react',
      autoCodeSplitting: true,
      routeFileIgnorePattern: '.((test).ts)|test-page',
    }),
    react(),
    tailwindcss(),
    injectGoogleAnalytics(),
  ],
  build: {
    outDir: './dist-web',
    emptyOutDir: true,
    rollupOptions: {
      external: [
        // Exclude Tauri packages from web bundle
        '@tauri-apps/api',
        '@tauri-apps/plugin-http',
        '@tauri-apps/plugin-fs',
        '@tauri-apps/plugin-shell',
        '@tauri-apps/plugin-clipboard-manager',
        '@tauri-apps/plugin-os',
        '@tauri-apps/plugin-process',
        '@tauri-apps/plugin-updater',
        '@tauri-apps/plugin-deep-link',
        '@tauri-apps/api/event',
        '@tauri-apps/api/path',
        '@tauri-apps/api/window',
        '@tauri-apps/api/webviewWindow',
      ],
    },
    target: 'esnext',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@janhq/conversational-extension': path.resolve(__dirname, '../extensions-web/src/conversational-web/index.ts'),
    },
  },
  define: {
    IS_TAURI: JSON.stringify(process.env.IS_TAURI),
    // Platform detection constants for web version
    IS_WEB_APP: JSON.stringify(true),
    // Disable auto-updater on web (not applicable)
    AUTO_UPDATER_DISABLED: JSON.stringify(true),
    IS_DEV: JSON.stringify(false),
    IS_MACOS: JSON.stringify(false),
    IS_WINDOWS: JSON.stringify(false),
    IS_LINUX: JSON.stringify(false),
    IS_IOS: JSON.stringify(false),
    IS_ANDROID: JSON.stringify(false),
    PLATFORM: JSON.stringify('web'),
    VERSION: JSON.stringify(process.env.npm_package_version || '1.0.0'),
    POSTHOG_KEY: JSON.stringify(process.env.POSTHOG_KEY || ''),
    POSTHOG_HOST: JSON.stringify(process.env.POSTHOG_HOST || ''),
    GA_MEASUREMENT_ID: JSON.stringify(process.env.GA_MEASUREMENT_ID),
    MODEL_CATALOG_URL: JSON.stringify(process.env.MODEL_CATALOG_URL || ''),
  },
  server: {
    port: 3001,
    strictPort: true,
  },
  // Enable SPA mode - fallback to index.html for all routes
  appType: 'spa',
})
