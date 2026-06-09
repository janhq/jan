import { LogicalPosition, LogicalSize } from '@tauri-apps/api/dpi'
import { Webview } from '@tauri-apps/api/webview'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { useCallback, useEffect, useRef } from 'react'
import type { RefObject } from 'react'

import { isPlatformTauri } from '@/lib/platform/utils'

const WEBVIEW_LABEL = 'workspace-browser-panel'

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

  const syncBounds = useCallback(async () => {
    const container = containerRef.current
    const webview = webviewRef.current
    if (!container || !webview) return

    const bounds = getContainerBounds(container)
    await webview.setPosition(new LogicalPosition(bounds.x, bounds.y))
    await webview.setSize(new LogicalSize(bounds.width, bounds.height))
  }, [containerRef])

  const teardownWebview = useCallback(async () => {
    const webview = webviewRef.current
    webviewRef.current = null
    mountedUrlRef.current = null
    if (!webview) return

    try {
      await webview.hide()
      await webview.close()
    } catch {
      // Non-fatal when the panel unmounts during app shutdown.
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
        await webviewRef.current.show()
        await syncBounds()
        return
      }

      await teardownWebview()
      if (cancelled) return

      const bounds = getContainerBounds(container)
      const parentWindow = getCurrentWebviewWindow()
      const webview = new Webview(parentWindow, WEBVIEW_LABEL, {
        url: activeUrl,
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        focus: false,
        zoomHotkeysEnabled: false,
      })

      await new Promise<void>((resolve) => {
        let settled = false
        const settle = () => {
          if (settled) return
          settled = true
          resolve()
        }

        void webview.once('tauri://created', settle)
        void webview.once('tauri://error', settle)
        window.setTimeout(settle, 1500)
      })

      if (cancelled) {
        await webview.close()
        return
      }

      webviewRef.current = webview
      mountedUrlRef.current = activeUrl
      await webview.show()
      await syncBounds()
    }

    void mountWebview()

    return () => {
      cancelled = true
      void teardownWebview()
    }
  }, [activeUrl, containerRef, isActive, syncBounds, teardownWebview])

  useEffect(() => {
    if (!isPlatformTauri() || !isActive || !activeUrl) return

    const container = containerRef.current
    if (!container) return

    const handleLayoutChange = () => {
      void syncBounds()
    }

    const resizeObserver = new ResizeObserver(handleLayoutChange)
    resizeObserver.observe(container)
    window.addEventListener('resize', handleLayoutChange)
    window.addEventListener('scroll', handleLayoutChange, true)

    return () => {
      resizeObserver.disconnect()
      window.removeEventListener('resize', handleLayoutChange)
      window.removeEventListener('scroll', handleLayoutChange, true)
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
