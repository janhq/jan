import { defineConfig, loadEnv, Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import { TanStackRouterVite } from '@tanstack/router-plugin/vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import packageJson from './package.json'
const host = process.env.TAURI_DEV_HOST

// Plugin to inject GA scripts in HTML
function injectGoogleAnalytics(gaMeasurementId?: string): Plugin {
  return {
    name: 'inject-google-analytics',
    transformIndexHtml(html) {
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

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory.
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [
      TanStackRouterVite({
        target: 'react',
        autoCodeSplitting: true,
        routeFileIgnorePattern: '.((test).ts)|test-page',
      }),
      react(),
      tailwindcss(),
      nodePolyfills({
        include: ['path'],
        globals: {
          Buffer: false,
          global: false,
          process: false,
        },
      }),
      injectGoogleAnalytics(env.GA_MEASUREMENT_ID),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        '@janhq/core': path.resolve(__dirname, '../core/src/index.ts'),
        '@janhq/conversational-extension': path.resolve(__dirname, '../extensions/conversational-extension/src/index.ts'),
      },
    },
    define: {
      IS_TAURI: JSON.stringify(process.env.IS_TAURI),
      IS_DEV: JSON.stringify(process.env.IS_DEV),
      IS_WEB_APP: JSON.stringify(false),
      IS_MACOS: JSON.stringify(
        process.env.TAURI_ENV_PLATFORM?.includes('darwin') ?? false
      ),
      IS_WINDOWS: JSON.stringify(
        process.env.TAURI_ENV_PLATFORM?.includes('windows') ?? false
      ),
      IS_LINUX: JSON.stringify(
        process.env.TAURI_ENV_PLATFORM?.includes('linux') ?? false
      ),
      IS_IOS: JSON.stringify(
        process.env.TAURI_ENV_PLATFORM?.includes('ios') ?? false
      ),
      IS_ANDROID: JSON.stringify(
        process.env.TAURI_ENV_PLATFORM?.includes('android') ?? false
      ),
      PLATFORM: JSON.stringify(process.env.TAURI_ENV_PLATFORM),

      VERSION: JSON.stringify(packageJson.version),

      POSTHOG_KEY: JSON.stringify(env.POSTHOG_KEY),
      POSTHOG_HOST: JSON.stringify(env.POSTHOG_HOST),
      GA_MEASUREMENT_ID: JSON.stringify(env.GA_MEASUREMENT_ID),
      // Legacy compile-time constant: the original `janhq/model-catalog`
      // CDN. Kept for one release window so any out-of-band code path that
      // still reads `MODEL_CATALOG_URL` does not break. New runtime code
      // (see `services/model-catalog-registry.ts`) reads the curated
      // catalog from `AtomicBot-ai/atomic-chat-model-catalog`'s
      // `dist/` folder on main via `raw.githubusercontent.com` (and the
      // override `VITE_MODEL_CATALOG_URL` / `VITE_MODEL_CATALOG_INDEX_URL`).
      // Once the legacy consumers are gone, this define block can be deleted.
      MODEL_CATALOG_URL: JSON.stringify(
        env.VITE_MODEL_CATALOG_URL ||
          'https://raw.githubusercontent.com/AtomicBot-ai/atomic-chat-model-catalog/main/dist/catalog.json'
      ),
      AUTO_UPDATER_DISABLED: JSON.stringify(
        env.AUTO_UPDATER_DISABLED === 'true'
      ),
      FORCE_ONBOARDING: JSON.stringify(
        process.env.FORCE_ONBOARDING === 'true' ||
          env.FORCE_ONBOARDING === 'true'
      ),
      UPDATE_CHECK_INTERVAL_MS: JSON.stringify(
        Number(env.UPDATE_CHECK_INTERVAL_MS) || 60 * 60 * 1000
      ),
    },

    // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
    //
    // 1. prevent vite from obscuring rust errors
    clearScreen: false,
    // 2. tauri expects a fixed port, fail if that port is not available
    server: {
      port: 1420,
      strictPort: true,
      host: host || false,
      hmr: host
        ? {
            protocol: 'ws',
            host,
            port: 1421,
          }
        : undefined,
      watch: {
        // 3. tell vite to ignore watching `src-tauri`
        ignored: ['**/src-tauri/**'],
        usePolling: true
      },
    },
  }
})
