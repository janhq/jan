import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import { primaryMonitor } from '@tauri-apps/api/window'
import { route } from '@/constants/routes'
import {
  SCREEN_CAPTURE_OVERLAY_LABEL,
  SCREEN_CAPTURE_REGION_LABEL,
} from '@/constants/screenCapture'

async function waitForWebviewAttach(): Promise<void> {
  await new Promise((r) => setTimeout(r, 450))
}

export async function openScreenCaptureOverlayWindow(): Promise<void> {
  const existing = await WebviewWindow.getByLabel(SCREEN_CAPTURE_OVERLAY_LABEL)
  if (existing) {
    try {
      await existing.setIgnoreCursorEvents(false)
    } catch {
      /* ignore */
    }
    await existing.show()
    await existing.setAlwaysOnTop(true)
    await existing.setFocus()
    return
  }

  const w = new WebviewWindow(SCREEN_CAPTURE_OVERLAY_LABEL, {
    url: route.screenCaptureOverlay,
    title: 'Quick capture',
    width: 400,
    height: 72,
    minWidth: 360,
    minHeight: 64,
    resizable: true,
    maximizable: false,
    decorations: false,
    transparent: true,
    shadow: false,
    alwaysOnTop: true,
    skipTaskbar: false,
    visible: false,
    center: true,
    focus: true,
  })

  await waitForWebviewAttach()
  await w.show()
  await w.setAlwaysOnTop(true)
}

export async function closeScreenCaptureOverlayWindow(): Promise<void> {
  const w = await WebviewWindow.getByLabel(SCREEN_CAPTURE_OVERLAY_LABEL)
  await w?.close()
}

export async function restoreOverlayCursorTargeting(): Promise<void> {
  const w = await WebviewWindow.getByLabel(SCREEN_CAPTURE_OVERLAY_LABEL)
  if (!w) return
  try {
    await w.setIgnoreCursorEvents(false)
  } catch {
    /* ignore */
  }
}

export async function openScreenCaptureRegionWindow(): Promise<void> {
  const prev = await WebviewWindow.getByLabel(SCREEN_CAPTURE_REGION_LABEL)
  if (prev) {
    await prev.close()
  }

  const w = new WebviewWindow(SCREEN_CAPTURE_REGION_LABEL, {
    url: route.screenCaptureRegion,
    title: 'Select screen region',
    fullscreen: false,
    width: 400,
    height: 300,
    resizable: false,
    maximizable: false,
    minimizable: false,
    decorations: false,
    transparent: true,
    shadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    visible: false,
    focus: true,
  })

  await waitForWebviewAttach()

  const mon = await primaryMonitor()
  if (mon) {
    await w.setPosition(mon.position)
    await w.setSize(mon.size)
  }
  await w.setAlwaysOnTop(true)
  await w.show()
}
