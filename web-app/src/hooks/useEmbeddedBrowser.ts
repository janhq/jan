import { LogicalPosition, LogicalSize } from '@tauri-apps/api/dpi'
import { Webview } from '@tauri-apps/api/webview'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { useCallback, useEffect, useRef } from 'react'
import type { RefObject } from 'react'

import { isPlatformTauri } from '@/lib/platform/utils'
import { rafThrottle } from '@/lib/throttle'

const WEBVIEW_LABEL_PREFIX = 'workspace-browser-panel'
let nextWebviewId = 0

function getContainerBounds(container: HTMLElement) {
  const rect = container.getBoundingClientRect()
  return {
    x: Math.max(Math.round(rect.left), 0),
    y: Math.max(Math.round(rect.top), 0),
    width: Math.max(Math.round(rect.width), 1),
    height: Math.max(Math.round(rect.height), 1),
  }
}

export function useEmbeddedBrowser(
  containerRef: RefObject<HTMLElement | null>,
  activeUrl: string | null,
  isActive: boolean
) {
  const webviewRef = useRef<Webview | null>(null)
  const mountedUrlRef = useRef<string | null>(null)
  const teardownPromiseRef = useRef<Promise<void> | null>(null)
  const webviewLabelRef = useRef<string | null>(null)

  if (webviewLabelRef.current === null) {
    nextWebviewId += 1
    webviewLabelRef.current = `${WEBVIEW_LABEL_PREFIX}-${nextWebviewId}`
  }
  const webviewLabel = webviewLabelRef.current

  const syncBounds = useCallback(async () => {
    const container = containerRef.current
    const webview = webviewRef.current
    if (!container || !webview) return

    try {
      const bounds = getContainerBounds(container)
      console.log('[EmbeddedBrowser] Syncing bounds:', bounds)
      await webview.setPosition(new LogicalPosition(bounds.x, bounds.y))
      await webview.setSize(new LogicalSize(bounds.width, bounds.height))
    } catch (err) {
      console.error('[EmbeddedBrowser] Failed to sync bounds:', err)
    }
  }, [containerRef])

  const teardownWebview = useCallback(async () => {
    const pendingTeardown = teardownPromiseRef.current
    if (pendingTeardown) {
      await pendingTeardown
    }

    const webview = webviewRef.current
    webviewRef.current = null
    mountedUrlRef.current = null
    if (!webview) return

    const teardown = (async () => {
      console.log('[EmbeddedBrowser] Tearing down webview')
      await webview.hide().catch((err) => {
        console.warn('[EmbeddedBrowser] Non-fatal hide error:', err)
      })
      await webview.close()
    })().catch((err) => {
      console.warn('[EmbeddedBrowser] Non-fatal teardown error:', err)
    })

    teardownPromiseRef.current = teardown

    try {
      await teardown
    } finally {
      if (teardownPromiseRef.current === teardown) {
        teardownPromiseRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (!isPlatformTauri()) return

    if (!isActive || !activeUrl) {
      void teardownWebview()
      return
    }

    let cancelled = false

    const mountWebview = async () => {
      const container = containerRef.current
      if (!container || cancelled) return

      if (webviewRef.current && mountedUrlRef.current === activeUrl) {
        try {
          console.log('[EmbeddedBrowser] Re-showing existing webview')
          await webviewRef.current.show()
          await syncBounds()
        } catch (err) {
          console.error('[EmbeddedBrowser] Failed to show existing webview:', err)
        }
        return
      }

      await teardownWebview()
      if (cancelled) return

      try {
        const bounds = getContainerBounds(container)
        const parentWindow = getCurrentWebviewWindow()
        console.log('[EmbeddedBrowser] Creating new webview with URL:', activeUrl, 'bounds:', bounds)
        const webview = new Webview(parentWindow, webviewLabel, {
          url: activeUrl,
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
          focus: false,
          zoomHotkeysEnabled: false,
        })
        webviewRef.current = webview
        mountedUrlRef.current = activeUrl

        await new Promise<void>((resolve) => {
          let settled = false
          const settle = () => {
            if (settled) return
            settled = true
            resolve()
          }

          void webview.once('tauri://created', () => {
            console.log('[EmbeddedBrowser] Webview tauri://created event received')
            settle()
          })
          void webview.once('tauri://error', (err) => {
            console.error('[EmbeddedBrowser] Webview tauri://error event received:', err)
            settle()
          })
          window.setTimeout(() => {
            console.warn('[EmbeddedBrowser] Webview initialization timed out after 1.5s')
            settle()
          }, 1500)
        })

        if (cancelled || webviewRef.current !== webview) {
          console.log('[EmbeddedBrowser] Creation cancelled, closing webview')
          await webview.close().catch((err) => {
            console.warn('[EmbeddedBrowser] Non-fatal cancelled close error:', err)
          })
          return
        }

        await webview.show()
        await syncBounds()
        console.log('[EmbeddedBrowser] Webview successfully shown and synced')
      } catch (err) {
        console.error('[EmbeddedBrowser] Critical error creating or showing webview:', err)
      }
    }

    void mountWebview()

    return () => {
      cancelled = true
      void teardownWebview()
    }
  }, [activeUrl, containerRef, isActive, syncBounds, teardownWebview, webviewLabel])

  useEffect(() => {
    if (!isPlatformTauri() || !isActive || !activeUrl) return

    const container = containerRef.current
    if (!container) return

    const scheduleBoundsSync = rafThrottle(() => {
      void syncBounds()
    })

    const resizeObserver = new ResizeObserver(scheduleBoundsSync)
    resizeObserver.observe(container)
    window.addEventListener('resize', scheduleBoundsSync)
    window.addEventListener('scroll', scheduleBoundsSync, true)

    return () => {
      resizeObserver.disconnect()
      window.removeEventListener('resize', scheduleBoundsSync)
      window.removeEventListener('scroll', scheduleBoundsSync, true)
    }
  }, [activeUrl, containerRef, isActive, syncBounds])

  useEffect(() => {
    if (!isPlatformTauri() || !webviewRef.current) return

    if (isActive && activeUrl) {
      void webviewRef.current.show()
      void syncBounds()
      return
    }

    void webviewRef.current.hide()
  }, [activeUrl, isActive, syncBounds])
}
