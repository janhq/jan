const DEFAULT_MIN_WIDTH = 400

export const mainWindowConfig: Electron.BrowserWindowConstructorOptions = {
  skipTaskbar: false,
  minWidth: DEFAULT_MIN_WIDTH,
  show: true,
  titleBarStyle: 'hidden',
  vibrancy: 'fullscreen-ui',
  visualEffectState: 'active',
  backgroundMaterial: 'acrylic',
  maximizable: false,
  autoHideMenuBar: true,
  trafficLightPosition: {
    x: 16,
    y: 10,
  },
}
