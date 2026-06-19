import { StrictMode } from 'react'
import ReactDOM from 'react-dom/client'
import { RouterProvider, createRouter } from '@tanstack/react-router'
import { invoke } from '@tauri-apps/api/core'
import {
  pruneLocalStorageByFlags,
  type WebdataResetFlags,
} from '@/services/app/reset-localstorage'

import './index.css'

// Mobile-specific viewport and styling setup
const setupMobileViewport = () => {
  // Check if running on mobile platform (iOS/Android via Tauri)
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) ||
                   window.matchMedia('(max-width: 768px)').matches

  if (isMobile) {
    // Update viewport meta tag to disable zoom
    const viewportMeta = document.querySelector('meta[name="viewport"]')
    if (viewportMeta) {
      viewportMeta.setAttribute('content',
        'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover'
      )
    }

    // Add mobile-specific styles for status bar
    const style = document.createElement('style')
    style.textContent = `
      body {
        padding-top: env(safe-area-inset-top);
        padding-bottom: env(safe-area-inset-bottom);
        padding-left: env(safe-area-inset-left);
        padding-right: env(safe-area-inset-right);
      }

      #root {
        min-height: calc(100vh - env(safe-area-inset-top) - env(safe-area-inset-bottom));
      }

      /* Prevent zoom on input focus */
      input, textarea, select {
        font-size: 16px !important;
      }
    `
    document.head.appendChild(style)
  }
}

// Prevent browser from opening dropped files
const preventDefaultFileDrop = () => {
  document.addEventListener('dragover', (e) => {
    e.preventDefault()
  })
  document.addEventListener('drop', (e) => {
    e.preventDefault()
  })
}

// Register the router instance for type safety
declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createRouter>
  }
}

// Consume a pending factory-reset sentinel and prune persisted UI state BEFORE
// any store module loads (Zustand persist hydrates synchronously at import).
// This is the only race-free, cross-platform way to clear webview localStorage.
const consumePendingWebdataReset = async () => {
  try {
    const flags = await invoke<WebdataResetFlags | null>(
      'take_pending_webdata_reset'
    )
    if (flags) pruneLocalStorageByFlags(flags)
  } catch {
    // Non-Tauri (web) build or no sentinel — nothing to do.
  }
}

const boot = async () => {
  setupMobileViewport()
  preventDefaultFileDrop()

  await consumePendingWebdataReset()

  // Dynamic imports keep store hydration AFTER the localStorage prune above.
  const { routeTree } = await import('./routeTree.gen')
  await import('./i18n')

  const router = createRouter({ routeTree })

  const rootElement = document.getElementById('root')!
  if (!rootElement.innerHTML) {
    const root = ReactDOM.createRoot(rootElement)
    root.render(
      <StrictMode>
        <RouterProvider router={router} />
      </StrictMode>
    )
  }
}

boot().catch((e) => console.error('Failed to boot app:', e))
