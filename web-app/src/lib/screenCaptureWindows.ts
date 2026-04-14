import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import { availableMonitors, primaryMonitor } from '@tauri-apps/api/window'
import { route } from '@/constants/routes'
import {
  SCREEN_CAPTURE_OVERLAY_LABEL,
  SCREEN_CAPTURE_REGION_LABEL,
} from '@/constants/screenCapture'

/** Wait until the native webview exists (`tauri://created`) or fail on `tauri://error`. */
/** Bounding box covering every monitor so region selection works on secondary displays. */
export async function getUnionOfAllMonitorsPhysicalRect(): Promise<{
  position: { x: number; y: number }
  size: { width: number; height: number }
} | null> {
  const monitors = await availableMonitors()
  if (monitors.length === 0) {
    const m = await primaryMonitor()
    return m ? { position: m.position, size: m.size } : null
  }
  let minX = Infinity
  let minY = Infinity
  let maxRight = -Infinity
  let maxBottom = -Infinity
  for (const m of monitors) {
    const { x, y } = m.position
    const w = m.size.width
    const h = m.size.height
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxRight = Math.max(maxRight, x + w)
    maxBottom = Math.max(maxBottom, y + h)
  }
  return {
    position: { x: minX, y: minY },
    size: { width: maxRight - minX, height: maxBottom - minY },
  }
}

function waitForWebviewWindowReady(w: WebviewWindow): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (op: () => void) => {
      if (settled) return
      settled = true
      op()
    }
    void w.once('tauri://created', () => {
      finish(() => resolve())
    })
    void w.once('tauri://error', (e) => {
      finish(() => {
        const msg =
          e != null &&
          typeof e === 'object' &&
          'payload' in e &&
          typeof (e as { payload?: unknown }).payload === 'string'
            ? (e as { payload: string }).payload
            : 'Failed to create webview window'
        reject(new Error(msg))
      })
    })
  })
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
    height: 136,
    minWidth: 360,
    minHeight: 72,
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

  await waitForWebviewWindowReady(w)
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

  await waitForWebviewWindowReady(w)

  const bounds = await getUnionOfAllMonitorsPhysicalRect()
  if (bounds) {
    await w.setPosition(bounds.position)
    await w.setSize(bounds.size)
  }
  await w.setAlwaysOnTop(true)
  await w.show()
}
