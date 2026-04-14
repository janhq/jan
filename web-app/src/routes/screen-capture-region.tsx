import { createFileRoute } from '@tanstack/react-router'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  readScreenCaptureComposerDraft,
  writeScreenCaptureComposerDraft,
} from '@/constants/screenCapture'
import { getUnionOfAllMonitorsPhysicalRect } from '@/lib/screenCaptureWindows'
import { route } from '@/constants/routes'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'

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

  const [noteAfterCaptureOpen, setNoteAfterCaptureOpen] = useState(false)
  const [pendingB64, setPendingB64] = useState<string | null>(null)
  const [noteDraft, setNoteDraft] = useState('')
  /** When true, closing the note dialog is from a successful publish — do not run cancel (discard) logic. */
  const suppressNoteDialogCancelRef = useRef(false)

  useEffect(() => {
    const place = async () => {
      const win = getCurrentWebviewWindow()
      const bounds = await getUnionOfAllMonitorsPhysicalRect()
      if (bounds) {
        await win.setPosition(bounds.position)
        await win.setSize(bounds.size)
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
      toast.dismiss(loading)
      setPendingB64(b64)
      setNoteDraft(readScreenCaptureComposerDraft())
      setNoteAfterCaptureOpen(true)
    } catch (e) {
      toast.dismiss(loading)
      toast.error('Region capture failed', { description: String(e) })
      await getCurrentWebviewWindow().close()
    }
  }, [])

  const publishRegionCapture = useCallback(
    async (mode: 'with_note' | 'skip_note') => {
      if (!pendingB64) return
      const b64 = pendingB64
      try {
        if (mode === 'with_note') {
          writeScreenCaptureComposerDraft(noteDraft)
          const trimmed = noteDraft.trim()
          await invoke(
            'publish_screen_capture_png',
            trimmed ? { pngBase64: b64, instruction: trimmed } : { pngBase64: b64 }
          )
        } else {
          await invoke('publish_screen_capture_png', { pngBase64: b64 })
        }
      } catch (e) {
        toast.error('Could not send capture', { description: String(e) })
        return
      }
      suppressNoteDialogCancelRef.current = true
      setNoteAfterCaptureOpen(false)
      setPendingB64(null)
      await getCurrentWebviewWindow().close()
    },
    [pendingB64, noteDraft]
  )

  const cancelRegionNote = useCallback(async () => {
    setNoteAfterCaptureOpen(false)
    setPendingB64(null)
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
    <>
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

      <Dialog
        open={noteAfterCaptureOpen}
        onOpenChange={(open) => {
          if (open) return
          if (suppressNoteDialogCancelRef.current) {
            suppressNoteDialogCancelRef.current = false
            return
          }
          void cancelRegionNote()
        }}
      >
        <DialogContent
          className="sm:max-w-md !max-h-none overflow-y-visible"
          showCloseButton
        >
          <DialogHeader>
            <DialogTitle>Optional note</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            Add text to send with the capture (shown above OCR in chat). Leave blank to skip.
          </p>
          <Textarea
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            placeholder="Optional message…"
            rows={4}
            className="min-h-[6.5rem] resize-none text-sm"
            spellCheck
          />
          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => void cancelRegionNote()}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void publishRegionCapture('skip_note')}
            >
              Skip note
            </Button>
            <Button type="button" size="sm" onClick={() => void publishRegionCapture('with_note')}>
              Continue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
