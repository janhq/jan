import { useEffect } from 'react'
import { isMac, PlatformShortcuts, ShortcutAction } from '@/lib/shortcuts'
import type { ShortcutSpec } from '@/lib/shortcuts'
import { useInterfaceSettings } from './useInterfaceSettings'

const matchesZoomKey = (event: KeyboardEvent, spec: ShortcutSpec) => {
  const metaKeyHeld = isMac ? event.metaKey : event.ctrlKey
  const otherMetaKeyHeld = isMac ? event.ctrlKey : event.metaKey
  if (!metaKeyHeld || otherMetaKeyHeld || event.altKey) return false
  // Shift is not compared: '+' only exists as a shifted key on most layouts.
  return [spec.key, ...(spec.aliasKeys ?? [])].some((key) => key === event.key)
}

/**
 * Binds the zoom shortcuts and Ctrl/Cmd + wheel to the chat message scale.
 *
 * Native webview zoom is off (`zoomHotkeysEnabled: false`), so these gestures
 * would otherwise do nothing; the default is still prevented for the browser
 * build, where the page would zoom instead.
 */
export function useMessageZoom() {
  useEffect(() => {
    const zoomIn = PlatformShortcuts[ShortcutAction.ZOOM_IN]
    const zoomOut = PlatformShortcuts[ShortcutAction.ZOOM_OUT]

    const handleKeyDown = (event: KeyboardEvent) => {
      const { zoomInMessages, zoomOutMessages } = useInterfaceSettings.getState()
      if (matchesZoomKey(event, zoomIn)) {
        event.preventDefault()
        zoomInMessages()
      } else if (matchesZoomKey(event, zoomOut)) {
        event.preventDefault()
        zoomOutMessages()
      }
    }

    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return
      if (event.deltaY === 0) return
      event.preventDefault()
      const { zoomInMessages, zoomOutMessages } = useInterfaceSettings.getState()
      if (event.deltaY < 0) zoomInMessages()
      else zoomOutMessages()
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('wheel', handleWheel, { passive: false })
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('wheel', handleWheel)
    }
  }, [])
}
