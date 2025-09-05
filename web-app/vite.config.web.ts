import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import { TanStackRouterVite } from '@tanstack/router-plugin/vite'

export default defineConfig({
  plugins: [
    TanStackRouterVite({
      target: 'react',
      autoCodeSplitting: true,
      routeFileIgnorePattern: '.((test).ts)|test-page',
    }),
    react(),
    tailwindcss(),
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
        '@tauri-apps/plugin-dialog',
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
    },
  },
  define: {
    IS_TAURI: JSON.stringify(process.env.IS_TAURI),
    // Platform detection constants for web version
    IS_WEB_APP: JSON.stringify(true),
    // Disable auto-updater on web (not applicable)
    AUTO_UPDATER_DISABLED: JSON.stringify(true),
    IS_MACOS: JSON.stringify(false),
    IS_WINDOWS: JSON.stringify(false),
    IS_LINUX: JSON.stringify(false),
    IS_IOS: JSON.stringify(false),
    IS_ANDROID: JSON.stringify(false),
    PLATFORM: JSON.stringify('web'),
    VERSION: JSON.stringify(process.env.npm_package_version || '1.0.0'),
    POSTHOG_KEY: JSON.stringify(process.env.POSTHOG_KEY || ''),
    POSTHOG_HOST: JSON.stringify(process.env.POSTHOG_HOST || ''),
    MODEL_CATALOG_URL: JSON.stringify(process.env.MODEL_CATALOG_URL || ''),
  },
  server: {
    port: 3001,
    strictPort: true,
  },
  // Enable SPA mode - fallback to index.html for all routes
  appType: 'spa',
})
