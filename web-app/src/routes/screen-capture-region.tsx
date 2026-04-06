import { createFileRoute } from '@tanstack/react-router'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { primaryMonitor } from '@tauri-apps/api/window'
import { useCallback, useEffect, useRef, useState } from 'react'
import { route } from '@/constants/routes'
import { toast } from 'sonner'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.screenCaptureRegion as any)({
  component: ScreenCaptureRegion,
})

async function clientToGlobalPhysical(
  clientX: number,
  clientY: number
): Promise<{ x: number; y: number }> {
  const win = getCurrentWebviewWindow()
  const outer = await win.outerPosition()
  const sf = await win.scaleFactor()
  return {
    x: outer.x + Math.round(clientX * sf),
    y: outer.y + Math.round(clientY * sf),
  }
}

function ScreenCaptureRegion() {
  const [clientBox, setClientBox] = useState<{
    x: number
    y: number
    w: number
    h: number
  } | null>(null)
  const startClientRef = useRef<{ x: number; y: number } | null>(null)
  const draggingRef = useRef(false)

  useEffect(() => {
    const place = async () => {
      const win = getCurrentWebviewWindow()
      const mon = await primaryMonitor()
      if (mon) {
        await win.setPosition(mon.position)
        await win.setSize(mon.size)
      }
      await win.setAlwaysOnTop(true)
    }
    void place()
  }, [])

  const finish = useCallback(async (x0: number, y0: number, x1: number, y1: number) => {
    const x = Math.min(x0, x1)
    const y = Math.min(y0, y1)
    const width = Math.abs(x1 - x0)
    const height = Math.abs(y1 - y0)
    if (width < 8 || height < 8) {
      toast.message('Selection too small', { description: 'Drag a larger rectangle.' })
      await getCurrentWebviewWindow().close()
      return
    }
    const loading = toast.loading('Capturing region…')
    try {
      const b64 = await invoke<string>('capture_screen_rect_png_base64', {
        x,
        y,
        width,
        height,
      })
      await invoke('publish_screen_capture_png', { pngBase64: b64 })
      toast.dismiss(loading)
    } catch (e) {
      toast.dismiss(loading)
      toast.error('Region capture failed', { description: String(e) })
    }
    await getCurrentWebviewWindow().close()
  }, [])

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    void (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    draggingRef.current = true
    startClientRef.current = { x: e.clientX, y: e.clientY }
    setClientBox(null)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!draggingRef.current || !startClientRef.current) return
    const s = startClientRef.current
    const x = Math.min(s.x, e.clientX)
    const y = Math.min(s.y, e.clientY)
    const w = Math.abs(e.clientX - s.x)
    const h = Math.abs(e.clientY - s.y)
    setClientBox({ x, y, w, h })
  }

  const onPointerUp = async (e: React.PointerEvent) => {
    if (!draggingRef.current || !startClientRef.current) return
    draggingRef.current = false
    try {
      void (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    const s = startClientRef.current
    startClientRef.current = null
    setClientBox(null)
    const g0 = await clientToGlobalPhysical(s.x, s.y)
    const g1 = await clientToGlobalPhysical(e.clientX, e.clientY)
    await finish(g0.x, g0.y, g1.x, g1.y)
  }

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        void getCurrentWebviewWindow().close()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div
      className="fixed inset-0 cursor-crosshair touch-none bg-black/35"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      role="presentation"
    >
      {clientBox && clientBox.w > 1 && clientBox.h > 1 ? (
        <div
          className="absolute border-2 border-primary bg-primary/15 pointer-events-none"
          style={{
            left: clientBox.x,
            top: clientBox.y,
            width: clientBox.w,
            height: clientBox.h,
          }}
        />
      ) : null}
      <div className="absolute bottom-6 left-0 right-0 text-center text-sm text-white drop-shadow-md pointer-events-none">
        Drag to select a region · Esc to cancel
      </div>
    </div>
  )
}
