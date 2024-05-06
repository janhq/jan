const DEFAULT_WIDTH = 900
const DEFAULT_MIN_WIDTH = 400
const DEFAULT_HEIGHT = 600

export const mainWindowConfig: Electron.BrowserWindowConstructorOptions = {
  width: DEFAULT_WIDTH,
  minWidth: DEFAULT_MIN_WIDTH,
  height: DEFAULT_HEIGHT,
  skipTaskbar: false,
  show: true,
  titleBarStyle: 'hiddenInset',
  vibrancy: 'sidebar',
}
