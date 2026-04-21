import { StrictMode } from 'react'
import ReactDOM from 'react-dom/client'
import { RouterProvider, createRouter } from '@tanstack/react-router'

// Import the generated route tree
import { routeTree } from './routeTree.gen'

import './index.css'
import './i18n'
import { migrateAllLocalStorageKeys } from './lib/fileStorage'
import { attachConsole } from '@tauri-apps/plugin-log'
import { logError } from './lib/logger'

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

// Create a new router instance
const router = createRouter({ routeTree })

// Register the router instance for type safety
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

// Migrate all localStorage data to file-based storage on startup
// so users updating the app don't lose their settings.
migrateAllLocalStorageKeys()

// Initialize mobile setup
setupMobileViewport()

// Prevent files from opening when dropped
preventDefaultFileDrop()

// Async logging initialization — must complete before React mount
// so startup exceptions are captured in app.jsonl.
async function initializeLogging() {
  try {
    await attachConsole()

    window.onerror = (
      message: string | Event,
      source?: string,
      lineno?: number,
      colno?: number,
      error?: Error
    ) => {
      logError(String(message), {
        url: window.location.href,
        stack: error?.stack,
        filename: source,
        line: lineno,
        col: colno,
      })
      return false
    }

    window.onunhandledrejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason
      logError(`Unhandled promise rejection: ${reason}`, {
        url: window.location.href,
        reason: String(reason),
        stack: reason?.stack,
      })
    }
  } catch (e) {
    console.error('Failed to initialize logging:', e)
  }
}

// Render the app after logging is ready
initializeLogging().then(() => {
  const rootElement = document.getElementById('root')!
  if (!rootElement.innerHTML) {
    const root = ReactDOM.createRoot(rootElement)
    root.render(
      <StrictMode>
        <RouterProvider router={router} />
      </StrictMode>
    )
  }
})
