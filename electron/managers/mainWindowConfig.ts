const DEFAULT_WIDTH = 1200
const DEFAULT_HEIGHT = 800

export const mainWindowConfig: Electron.BrowserWindowConstructorOptions = {
  width: DEFAULT_WIDTH,
  minWidth: DEFAULT_WIDTH,
  height: DEFAULT_HEIGHT,
  skipTaskbar: true,
  show: true,
  trafficLightPosition: {
    x: 10,
    y: 15,
  },
  titleBarStyle: 'hiddenInset',
  vibrancy: 'sidebar',
}
