const DEFAULT_WIDTH = 556

const DEFAULT_HEIGHT = 60

export const quickAskWindowConfig: Electron.BrowserWindowConstructorOptions = {
  width: DEFAULT_WIDTH,
  height: DEFAULT_HEIGHT,
  skipTaskbar: true,
  acceptFirstMouse: true,
  hasShadow: true,
  alwaysOnTop: true,
  show: false,
  fullscreenable: false,
  resizable: false,
  center: true,
  movable: true,
  maximizable: false,
  focusable: true,
  transparent: false,
  frame: false,
  type: 'panel',
}
