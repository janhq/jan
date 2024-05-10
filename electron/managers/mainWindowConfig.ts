const DEFAULT_MIN_WIDTH = 400

export const mainWindowConfig: Electron.BrowserWindowConstructorOptions = {
  skipTaskbar: false,
  minWidth: DEFAULT_MIN_WIDTH,
  show: true,
  titleBarStyle: 'hiddenInset',
  vibrancy: 'sidebar',
}
