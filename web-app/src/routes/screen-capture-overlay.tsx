import { createFileRoute } from '@tanstack/react-router'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { LogicalSize, PhysicalSize } from '@tauri-apps/api/window'
import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react'
import { route } from '@/constants/routes'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
  readScreenCaptureComposerDraft,
  writeScreenCaptureComposerDraft,
} from '@/constants/screenCapture'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { toast } from 'sonner'
import { openScreenCaptureRegionWindow } from '@/lib/screenCaptureWindows'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.screenCaptureOverlay as any)({
  component: ScreenCaptureOverlay,
})

type CaptureWindowItem = {
  id: number
  appName: string
  title: string
  x: number
  y: number
  width: number
  height: number
}

/** Large enough for the window list and quick-capture UI. */
const WINDOW_PICKER_LOGICAL_SIZE = new LogicalSize(560, 680)

function ScreenCaptureOverlay() {
  const [composer, setComposer] = useState(readScreenCaptureComposerDraft)
  const [passThrough, setPassThrough] = useState(false)
  const [windowPickerOpen, setWindowPickerOpen] = useState(false)
  const [windows, setWindows] = useState<CaptureWindowItem[]>([])
  const [loadingWindows, setLoadingWindows] = useState(false)
  const sizeBeforeWindowPickerRef = useRef<PhysicalSize | null>(null)

  useEffect(() => {
    const win = getCurrentWebviewWindow()
    void win.setAlwaysOnTop(true)
  }, [])

  useEffect(() => {
    writeScreenCaptureComposerDraft(composer)
  }, [composer])

  const applyPassThrough = useCallback(async (enabled: boolean) => {
    try {
      await getCurrentWebviewWindow().setIgnoreCursorEvents(enabled)
      setPassThrough(enabled)
      if (enabled) {
        toast.message('Click-through on', {
          description:
            'Use Settings → Advanced → Restore overlay mouse targeting to click the toolbar again.',
        })
      }
    } catch (e) {
      toast.error('Could not change click-through', { description: String(e) })
    }
  }, [])

  const publishB64 = async (b64: string) => {
    const instruction = composer.trim()
    writeScreenCaptureComposerDraft(composer)
    await invoke(
      'publish_screen_capture_png',
      instruction
        ? { pngBase64: b64, instruction }
        : { pngBase64: b64 }
    )
  }

  const captureFullScreen = async () => {
    const id = toast.loading('Capturing screen…')
    try {
      const b64 = await invoke<string>('capture_primary_display_png_base64')
      toast.dismiss(id)
      await publishB64(b64)
    } catch (e) {
      toast.dismiss(id)
      toast.error('Capture failed', { description: String(e) })
    }
  }

  const openRegion = async () => {
    writeScreenCaptureComposerDraft(composer)
    try {
      await openScreenCaptureRegionWindow()
    } catch (e) {
      toast.error('Could not open region picker', { description: String(e) })
    }
  }

  const expandOverlayForWindowPicker = useCallback(async () => {
    if (!IS_TAURI) return
    try {
      const win = getCurrentWebviewWindow()
      sizeBeforeWindowPickerRef.current = await win.innerSize()
      await win.setSize(WINDOW_PICKER_LOGICAL_SIZE)
    } catch (e) {
      console.error(e)
    }
  }, [])

  const restoreOverlayAfterWindowPicker = useCallback(async () => {
    if (!IS_TAURI) return
    const saved = sizeBeforeWindowPickerRef.current
    if (!saved) return
    sizeBeforeWindowPickerRef.current = null
    try {
      await getCurrentWebviewWindow().setSize(saved)
    } catch (e) {
      console.error(e)
    }
  }, [])

  const closeWindowPicker = useCallback(() => {
    setWindowPickerOpen(false)
    void restoreOverlayAfterWindowPicker()
  }, [restoreOverlayAfterWindowPicker])

  const openWindowPicker = async () => {
    writeScreenCaptureComposerDraft(composer)
    await expandOverlayForWindowPicker()
    setWindowPickerOpen(true)
    setLoadingWindows(true)
    try {
      const list = await invoke<CaptureWindowItem[]>('list_screen_capture_windows')
      setWindows(list ?? [])
    } catch (e) {
      toast.error('Could not list windows', { description: String(e) })
      setWindows([])
    } finally {
      setLoadingWindows(false)
    }
  }

  const captureWindow = async (windowId: number) => {
    closeWindowPicker()
    const id = toast.loading('Capturing window…')
    try {
      const b64 = await invoke<string>('capture_window_png_base64', { windowId })
      toast.dismiss(id)
      await publishB64(b64)
    } catch (e) {
      toast.dismiss(id)
      toast.error('Window capture failed', { description: String(e) })
    }
  }

  const closeSelf = () => {
    void getCurrentWebviewWindow().close()
  }

  const titleBarDrag =
    IS_TAURI && IS_LINUX
      ? {
          onMouseDown: (e: MouseEvent) => {
            if (e.button !== 0) return
            void getCurrentWebviewWindow().startDragging()
          },
        }
      : IS_TAURI
        ? { 'data-tauri-drag-region': true as const }
        : {}

  return (
    <div className="flex h-full w-full min-h-0 flex-col rounded-xl border border-border/80 bg-background/95 p-2.5 text-foreground shadow-xl backdrop-blur-md">
      <div className="flex min-h-0 flex-1 flex-col gap-2.5">
        <div
          className={
            IS_TAURI
              ? 'flex min-h-7 shrink-0 items-center gap-1.5 rounded-md px-0.5 text-xs font-medium text-muted-foreground select-none touch-none cursor-grab active:cursor-grabbing'
              : 'flex min-h-7 shrink-0 items-center gap-1.5 rounded-md px-0.5 text-xs font-medium text-muted-foreground select-none touch-none'
          }
          title={IS_TAURI ? 'Drag to move' : undefined}
          aria-label={IS_TAURI ? 'Drag to move window' : undefined}
          {...titleBarDrag}
        >
          <span className="truncate font-semibold text-foreground">Quick capture</span>
          <span className="truncate opacity-80">· Jan</span>
        </div>

        <Textarea
          value={composer}
          onChange={(e) => setComposer(e.target.value)}
          placeholder="Message to send with captured text (optional)…"
          rows={3}
          className="min-h-[4.5rem] resize-none rounded-lg border-border/80 bg-muted/40 text-sm shadow-inner placeholder:text-muted-foreground/70"
          spellCheck
        />

        <p className="text-[10px] leading-snug text-muted-foreground">
          Optional note is placed above OCR text (and your Settings instruction template, if any).
        </p>

        <div className="flex flex-wrap gap-1.5">
          <Button
            size="sm"
            variant="secondary"
            className="h-8 text-xs"
            onClick={() => void captureFullScreen()}
          >
            Full screen
          </Button>
          <Button
            size="sm"
            variant="secondary"
            className="h-8 text-xs"
            onClick={() => void openRegion()}
          >
            Region
          </Button>
          <Button
            size="sm"
            variant="secondary"
            className="h-8 text-xs"
            onClick={() => void openWindowPicker()}
          >
            Window…
          </Button>
        </div>

        <div className="mt-auto flex shrink-0 items-center justify-between gap-2 border-t border-border/50 pt-2">
          <label className="flex cursor-pointer items-center gap-2 text-xs select-none">
            <Switch
              checked={passThrough}
              onCheckedChange={(v) => void applyPassThrough(v)}
            />
            <span>Click-through</span>
          </label>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={closeSelf}>
            Close
          </Button>
        </div>
      </div>

      <Dialog
        open={windowPickerOpen}
        onOpenChange={(open) => {
          if (!open) closeWindowPicker()
        }}
      >
        <DialogContent
          className="!flex !w-full max-w-3xl !flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl"
          showCloseButton
        >
          <div className="flex max-h-[min(85vh,620px)] min-h-0 flex-col gap-4 overflow-hidden p-6">
            <DialogHeader className="shrink-0">
              <DialogTitle>Capture a window</DialogTitle>
            </DialogHeader>
            <div
              className="space-y-1 overflow-y-auto overscroll-contain pr-1"
              style={{
                maxHeight: 'min(440px, 55dvh)',
                WebkitOverflowScrolling: 'touch',
              }}
              onWheel={(e) => e.stopPropagation()}
            >
            {loadingWindows ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : windows.length === 0 ? (
              <p className="text-sm text-muted-foreground">No windows found.</p>
            ) : (
              windows.map((w) => (
                <button
                  key={w.id}
                  type="button"
                  className="w-full text-left rounded-md border border-border/60 px-2 py-1.5 text-xs hover:bg-accent"
                  onClick={() => void captureWindow(w.id)}
                >
                  <div className="font-medium truncate">{w.title || '(no title)'}</div>
                  <div className="text-muted-foreground truncate">{w.appName}</div>
                </button>
              ))
            )}
            </div>
            <DialogFooter className="shrink-0">
              <Button variant="outline" size="sm" onClick={closeWindowPicker}>
                Cancel
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
