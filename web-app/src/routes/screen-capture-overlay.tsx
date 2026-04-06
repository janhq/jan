import { createFileRoute } from '@tanstack/react-router'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { useCallback, useEffect, useState } from 'react'
import { route } from '@/constants/routes'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
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

function ScreenCaptureOverlay() {
  const [passThrough, setPassThrough] = useState(false)
  const [windowPickerOpen, setWindowPickerOpen] = useState(false)
  const [windows, setWindows] = useState<CaptureWindowItem[]>([])
  const [loadingWindows, setLoadingWindows] = useState(false)

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

  const publishB64 = async (b64: string) => {
    await invoke('publish_screen_capture_png', { pngBase64: b64 })
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
    try {
      await openScreenCaptureRegionWindow()
    } catch (e) {
      toast.error('Could not open region picker', { description: String(e) })
    }
  }

  const openWindowPicker = async () => {
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
    setWindowPickerOpen(false)
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

  return (
    <div className="h-full w-full p-2 bg-background/92 backdrop-blur-md rounded-lg border border-border shadow-lg text-foreground">
      <div className="flex flex-col gap-2 h-full min-h-0">
        <div className="text-xs font-medium text-muted-foreground truncate">
          Jan · screen capture
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="secondary" onClick={() => void captureFullScreen()}>
            Full screen
          </Button>
          <Button size="sm" variant="secondary" onClick={() => void openRegion()}>
            Region
          </Button>
          <Button size="sm" variant="secondary" onClick={() => void openWindowPicker()}>
            Window…
          </Button>
        </div>
        <div className="flex items-center justify-between gap-2 pt-1 border-t border-border/60">
          <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
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

      <Dialog open={windowPickerOpen} onOpenChange={setWindowPickerOpen}>
        <DialogContent className="sm:max-w-md max-h-[70vh] flex flex-col" showCloseButton>
          <DialogHeader>
            <DialogTitle>Capture a window</DialogTitle>
          </DialogHeader>
          <div className="overflow-y-auto flex-1 min-h-0 space-y-1 pr-1">
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
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setWindowPickerOpen(false)}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
