const DEFAULT_MIN_WIDTH = 400
const DEFAULT_MIN_HEIGHT = 300

export const mainWindowConfig: Electron.BrowserWindowConstructorOptions = {
  skipTaskbar: false,
  minWidth: DEFAULT_MIN_WIDTH,
  minHeight: DEFAULT_MIN_HEIGHT,
  show: true,
  transparent: true,
  frame: false,
  titleBarStyle: 'hidden',
  vibrancy: 'fullscreen-ui',
  visualEffectState: 'active',
  backgroundMaterial: 'acrylic',
  autoHideMenuBar: true,
  trafficLightPosition: {
    x: 16,
    y: 10,
  },
}
