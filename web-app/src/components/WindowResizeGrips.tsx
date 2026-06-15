import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import type { ResizeDirection } from '@tauri-apps/api/window'

/**
 * Invisible edge/corner grips that restore window resizing for a borderless
 * window. A decorations:false window on Wayland has no compositor-drawn resize
 * handles, so each grip forwards to the compositor's interactive resize.
 */
const GRIP = 'fixed z-[60]'
const EDGE = 4
const CORNER = 10

const startResize = (direction: ResizeDirection) => () => {
  void getCurrentWebviewWindow().startResizeDragging(direction)
}

export const WindowResizeGrips = () => (
  <>
    <div
      className={GRIP}
      style={{ top: 0, left: CORNER, right: CORNER, height: EDGE, cursor: 'ns-resize' }}
      onMouseDown={startResize('North')}
    />
    <div
      className={GRIP}
      style={{ bottom: 0, left: CORNER, right: CORNER, height: EDGE, cursor: 'ns-resize' }}
      onMouseDown={startResize('South')}
    />
    <div
      className={GRIP}
      style={{ top: CORNER, bottom: CORNER, left: 0, width: EDGE, cursor: 'ew-resize' }}
      onMouseDown={startResize('West')}
    />
    <div
      className={GRIP}
      style={{ top: CORNER, bottom: CORNER, right: 0, width: EDGE, cursor: 'ew-resize' }}
      onMouseDown={startResize('East')}
    />
    <div
      className={GRIP}
      style={{ top: 0, left: 0, width: CORNER, height: CORNER, cursor: 'nwse-resize' }}
      onMouseDown={startResize('NorthWest')}
    />
    <div
      className={GRIP}
      style={{ top: 0, right: 0, width: CORNER, height: CORNER, cursor: 'nesw-resize' }}
      onMouseDown={startResize('NorthEast')}
    />
    <div
      className={GRIP}
      style={{ bottom: 0, left: 0, width: CORNER, height: CORNER, cursor: 'nesw-resize' }}
      onMouseDown={startResize('SouthWest')}
    />
    <div
      className={GRIP}
      style={{ bottom: 0, right: 0, width: CORNER, height: CORNER, cursor: 'nwse-resize' }}
      onMouseDown={startResize('SouthEast')}
    />
  </>
)
