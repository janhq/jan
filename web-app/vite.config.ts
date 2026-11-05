import { defineConfig, loadEnv, Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import { TanStackRouterVite } from '@tanstack/router-plugin/vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import packageJson from './package.json'
const host = process.env.TAURI_DEV_HOST

// `tauri dev` / `tauri build` set TAURI_ENV_PLATFORM; a direct Tauri build
// (`build:e2e:app`, which runs `vite build` then cargo) does not, and would bake
// IS_MACOS=false into a macOS app (title-bar inset and traffic-light spacing
// lost). Tauri-only builds fall back to the host OS; plain web builds do not.
const hostPlatform: Record<string, string> = { darwin: 'darwin', win32: 'windows', linux: 'linux' }
const tauriPlatform =
  process.env.TAURI_ENV_PLATFORM ??
  (process.env.IS_TAURI === 'true' ? (hostPlatform[process.platform] ?? '') : '')

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
      }),
      injectGoogleAnalytics(env.GA_MEASUREMENT_ID),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        '@janhq/assistant-extension': path.resolve(__dirname, '../extensions/assistant-extension/dist/index.js'),
        '@janhq/download-extension': path.resolve(__dirname, '../extensions/download-extension/dist/index.js'),
        '@janhq/llamacpp-extension': path.resolve(__dirname, '../extensions/llamacpp-extension/dist/index.js'),
        '@janhq/mlx-extension': path.resolve(__dirname, '../extensions/mlx-extension/dist/index.js'),
        '@janhq/rag-extension': path.resolve(__dirname, '../extensions/rag-extension/dist/index.js'),
        '@janhq/vector-db-extension': path.resolve(__dirname, '../extensions/vector-db-extension/dist/index.js'),
      },
    },
    optimizeDeps: {
      // Extensions are prebuilt, self-contained ESM dist bundles. Excluding them
      // stops Vite's dev dep-optimizer from crawling/re-bundling them mid-boot,
      // which otherwise invalidates the in-flight dynamic import of the service
      // hub and surfaces as "Importing a module script failed" on cold start.
      exclude: [
        '@janhq/assistant-extension',
        '@janhq/download-extension',
        '@janhq/llamacpp-extension',
        '@janhq/mlx-extension',
        '@janhq/rag-extension',
        '@janhq/vector-db-extension',
      ],
    },
    define: {
      IS_TAURI: JSON.stringify(process.env.IS_TAURI),
      IS_DEV: JSON.stringify(process.env.IS_DEV),
      IS_WEB_APP: JSON.stringify(false),
      IS_MACOS: JSON.stringify(
        tauriPlatform.includes('darwin')
      ),
      IS_WINDOWS: JSON.stringify(
        tauriPlatform.includes('windows')
      ),
      IS_LINUX: JSON.stringify(
        tauriPlatform.includes('linux')
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
      MODEL_CATALOG_URL: JSON.stringify(
        'https://raw.githubusercontent.com/janhq/model-catalog/main/model_catalog_v2.json'
      ),
      LATEST_JAN_MODEL_URL: JSON.stringify(
        'https://raw.githubusercontent.com/janhq/model-catalog/main/latest_jan_model.json'
      ),
      AUTO_UPDATER_DISABLED: JSON.stringify(
        env.AUTO_UPDATER_DISABLED === 'true'
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
