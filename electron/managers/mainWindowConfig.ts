const DEFAULT_MIN_WIDTH = 400

export const mainWindowConfig: Electron.BrowserWindowConstructorOptions = {
  skipTaskbar: false,
  minWidth: DEFAULT_MIN_WIDTH,
  show: true,
  titleBarStyle: 'hidden',
  transparent: true,
  vibrancy: 'fullscreen-ui',
  visualEffectState: 'active',
  backgroundMaterial: 'acrylic',
  autoHideMenuBar: true,
}
