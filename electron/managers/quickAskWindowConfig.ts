const DEFAULT_WIDTH = 556

const DEFAULT_HEIGHT = 60

export const quickAskWindowConfig: Electron.BrowserWindowConstructorOptions = {
  width: DEFAULT_WIDTH,
  height: DEFAULT_HEIGHT,
  skipTaskbar: true,
  resizable: false,
  transparent: true,
  frame: false,
  type: 'panel',
}
