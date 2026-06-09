import { StrictMode } from 'react'
import ReactDOM from 'react-dom/client'
import { RouterProvider, createRouter } from '@tanstack/react-router'

// Import the generated route tree
import { routeTree } from './routeTree.gen'

import { getCurrentWebview } from '@tauri-apps/api/webview'

import './index.css'
import './i18n'

// Tauri injects a zoom polyfill when zoomHotkeysEnabled is true; trackpad pinch
// arrives as ctrl+wheel and scales the whole webview. Reset on startup for anyone
// who already zoomed, and keep pinch disabled via tauri.*.conf.json.
const resetWebviewZoom = () => {
  if (!IS_TAURI) return

  void getCurrentWebview()
    .setZoom(1)
    .catch(() => {
      // Non-fatal if the webview is not ready yet.
    })
}

// Prevent accidental Ctrl/⌘+wheel zoom events in the Tauri webview (often from
// tiny pinch gestures on trackpads).
const preventTauriPinchZoom = () => {
  if (!IS_TAURI) return

  const handleWheelZoom = (event: WheelEvent) => {
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault()
      event.stopPropagation()
    }
  }

  window.addEventListener('wheel', handleWheelZoom, {
    passive: false,
    capture: true,
  })
}

// Mobile-specific viewport and styling setup
const setupMobileViewport = () => {
  // Check if running on mobile platform (iOS/Android via Tauri)
  const isMobile =
    /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) ||
    window.matchMedia('(max-width: 768px)').matches

  if (isMobile) {
    // Update viewport meta tag to disable zoom
    const viewportMeta = document.querySelector('meta[name="viewport"]')
    if (viewportMeta) {
      viewportMeta.setAttribute(
        'content',
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

// Initialize mobile setup
setupMobileViewport()

// Prevent files from opening when dropped
preventDefaultFileDrop()

resetWebviewZoom()
preventTauriPinchZoom()

// Create a new router instance
const router = createRouter({ routeTree })

// Register the router instance for type safety
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

// Render the app
const rootElement = document.getElementById('root')!
if (!rootElement.innerHTML) {
  const root = ReactDOM.createRoot(rootElement)
  root.render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>
  )
}
