import { createFileRoute } from '@tanstack/react-router'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { LogicalSize, PhysicalSize } from '@tauri-apps/api/window'
import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react'
import { route } from '@/constants/routes'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import {
  ChevronDownIcon,
  MonitorIcon,
  SquareDashedIcon,
  AppWindowIcon,
  XIcon,
} from 'lucide-react'
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

type CaptureMode = 'screen' | 'window' | 'region'

/** Large enough for the window list and quick-capture UI. */
const WINDOW_PICKER_LOGICAL_SIZE = new LogicalSize(560, 680)

function ScreenCaptureOverlay() {
  const [passThrough, setPassThrough] = useState(false)
  const [windowPickerOpen, setWindowPickerOpen] = useState(false)
  const [windows, setWindows] = useState<CaptureWindowItem[]>([])
  const [loadingWindows, setLoadingWindows] = useState(false)
  const sizeBeforeWindowPickerRef = useRef<PhysicalSize | null>(null)

  /** Capture-first: optional note is collected after we have the PNG. */
  const [noteAfterCaptureOpen, setNoteAfterCaptureOpen] = useState(false)
  const [pendingB64, setPendingB64] = useState<string | null>(null)
  const [noteDraft, setNoteDraft] = useState('')
  const [captureMode, setCaptureMode] = useState<CaptureMode>('screen')

  useEffect(() => {
    const win = getCurrentWebviewWindow()
    void win.setAlwaysOnTop(true)
  }, [])

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

  const openNoteAfterCapture = (b64: string) => {
    setPendingB64(b64)
    setNoteDraft(readScreenCaptureComposerDraft())
    setNoteAfterCaptureOpen(true)
  }

  const closeNoteAfterCapture = () => {
    setNoteAfterCaptureOpen(false)
    setPendingB64(null)
  }

  const publishPendingCapture = async (mode: 'with_note' | 'skip_note') => {
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
      closeNoteAfterCapture()
    } catch (e) {
      toast.error('Could not send capture', { description: String(e) })
    }
  }

  const captureFullScreen = async () => {
    const id = toast.loading('Capturing screen…')
    try {
      const b64 = await invoke<string>('capture_primary_display_png_base64')
      toast.dismiss(id)
      openNoteAfterCapture(b64)
    } catch (e) {
      toast.dismiss(id)
      toast.error('Capture failed', { description: String(e) })
    }
  }

  const openRegion = async () => {
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
      openNoteAfterCapture(b64)
    } catch (e) {
      toast.dismiss(id)
      toast.error('Window capture failed', { description: String(e) })
    }
  }

  const closeSelf = () => {
    void getCurrentWebviewWindow().close()
  }

  const runCapture = () => {
    switch (captureMode) {
      case 'screen':
        void captureFullScreen()
        break
      case 'window':
        void openWindowPicker()
        break
      case 'region':
        void openRegion()
        break
      default:
        break
    }
  }

  /** Linux: no data-tauri-drag-region on webviews; use a dedicated strip so buttons stay clickable. */
  const linuxDragStrip =
    IS_TAURI && IS_LINUX
      ? {
          onMouseDown: (e: MouseEvent) => {
            if (e.button !== 0) return
            void getCurrentWebviewWindow().startDragging()
          },
        }
      : {}

  const toolbarDragRegion =
    IS_TAURI && !IS_LINUX ? { 'data-tauri-drag-region': true as const } : {}

  const modeButtonClass = (mode: CaptureMode) =>
    cn(
      'flex size-9 shrink-0 items-center justify-center rounded-md border border-transparent text-zinc-100 outline-none transition-colors',
      'hover:bg-white/12 focus-visible:ring-2 focus-visible:ring-white/35',
      captureMode === mode
        ? 'bg-white/18 ring-1 ring-white/25'
        : 'text-zinc-300/95 hover:text-zinc-50'
    )

  return (
    <div className="box-border flex h-fit max-h-full w-full min-h-0 shrink-0 flex-col rounded-xl border border-border/80 bg-background/95 p-1.5 text-foreground shadow-xl backdrop-blur-md">
      <div
        className="flex w-full min-w-0 items-center gap-0 rounded-lg border border-white/12 bg-zinc-900/90 py-1 pl-1 pr-1 shadow-inner backdrop-blur-xl"
        role="toolbar"
        aria-label={
          IS_TAURI && IS_LINUX
            ? 'Screen capture. Drag the space between Options and Capture to move the window.'
            : 'Screen capture. Drag the toolbar to move the window.'
        }
        {...toolbarDragRegion}
      >
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-8 shrink-0 rounded-full border border-white/15 text-zinc-200 hover:bg-white/10 hover:text-white"
          onClick={closeSelf}
          aria-label="Close"
        >
          <XIcon className="size-3.5" aria-hidden />
        </Button>

        <div className="mx-1 h-6 w-px shrink-0 bg-white/15" aria-hidden />

        <div className="flex min-w-0 items-center gap-0.5">
          <button
            type="button"
            className={modeButtonClass('screen')}
            aria-label="Entire screen"
            aria-pressed={captureMode === 'screen'}
            title="Entire screen"
            onClick={() => setCaptureMode('screen')}
          >
            <MonitorIcon className="size-[18px]" strokeWidth={1.75} aria-hidden />
          </button>
          <button
            type="button"
            className={modeButtonClass('window')}
            aria-label="Selected window"
            aria-pressed={captureMode === 'window'}
            title="Window"
            onClick={() => setCaptureMode('window')}
          >
            <AppWindowIcon className="size-[18px]" strokeWidth={1.75} aria-hidden />
          </button>
          <button
            type="button"
            className={modeButtonClass('region')}
            aria-label="Selected region"
            aria-pressed={captureMode === 'region'}
            title="Portion"
            onClick={() => setCaptureMode('region')}
          >
            <SquareDashedIcon className="size-[18px]" strokeWidth={1.75} aria-hidden />
          </button>
        </div>

        <div className="mx-1 h-6 w-px shrink-0 bg-white/15" aria-hidden />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 shrink-0 gap-0.5 px-2 text-[11px] font-medium text-zinc-200 hover:bg-white/10 hover:text-white"
            >
              Options
              <ChevronDownIcon className="size-3 opacity-80" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[10rem] text-xs" sideOffset={4}>
            <DropdownMenuCheckboxItem
              className="text-xs"
              checked={passThrough}
              onCheckedChange={(v) => void applyPassThrough(!!v)}
            >
              Click-through
            </DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <div
          className={cn(
            'min-w-6 flex-1',
            IS_TAURI && IS_LINUX && 'cursor-grab touch-none select-none active:cursor-grabbing'
          )}
          title={IS_TAURI && IS_LINUX ? 'Drag to move' : undefined}
          aria-hidden
          {...linuxDragStrip}
        />

        <Button
          type="button"
          size="sm"
          className="h-8 shrink-0 rounded-md bg-zinc-700 px-3 text-[11px] font-semibold text-white shadow-sm hover:bg-zinc-600"
          onClick={() => void runCapture()}
        >
          Capture
        </Button>
      </div>

      <Dialog
        open={noteAfterCaptureOpen}
        onOpenChange={(open) => {
          if (!open) closeNoteAfterCapture()
        }}
      >
        <DialogContent className="!flex !w-full max-w-md !flex-col gap-3 sm:max-w-md" showCloseButton>
          <DialogHeader className="shrink-0">
            <DialogTitle>Optional note</DialogTitle>
          </DialogHeader>
          <p className="text-[11px] leading-snug text-muted-foreground">
            Add text to send with the capture (shown above OCR in chat). Leave blank to skip.
          </p>
          <Textarea
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            placeholder="Optional message…"
            rows={3}
            className="field-sizing-fixed min-h-[4.5rem] resize-none rounded-md border-border/80 bg-muted/40 px-2 py-1.5 text-xs leading-snug shadow-inner placeholder:text-muted-foreground/70"
            spellCheck
          />
          <DialogFooter className="shrink-0 gap-2 sm:gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="text-[11px]"
              onClick={() => void publishPendingCapture('skip_note')}
            >
              Skip note
            </Button>
            <Button
              type="button"
              size="sm"
              className="text-[11px]"
              onClick={() => void publishPendingCapture('with_note')}
            >
              Continue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
