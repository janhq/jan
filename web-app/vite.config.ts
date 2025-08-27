import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import { TanStackRouterVite } from '@tanstack/router-plugin/vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import packageJson from './package.json'
const host = process.env.TAURI_DEV_HOST

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
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    define: {
      IS_TAURI: JSON.stringify(process.env.IS_TAURI),
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
      MODEL_CATALOG_URL: JSON.stringify(
        'https://raw.githubusercontent.com/menloresearch/model-catalog/main/model_catalog.json'
      ),
      AUTO_UPDATER_DISABLED: JSON.stringify(
        env.AUTO_UPDATER_DISABLED === 'true'
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
      },
    },
  }
})
