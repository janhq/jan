import { app } from 'electron'
import Store from 'electron-store'

const DEFAULT_WIDTH = 1000
const DEFAULT_HEIGHT = 700

const storage = new Store()

export const setupCore = async () => {
  // Setup core api for main process
  global.core = {
    // Define appPath function for app to retrieve app path globally
    appPath: () => app.getPath('userData'),
  }
}

export const getBounds = async () => {
  const defaultBounds = {
    x: undefined,
    y: undefined,
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
  }

  const bounds = await storage.get('windowBounds')
  if (bounds) {
    return bounds as Electron.Rectangle
  } else {
    storage.set('windowBounds', defaultBounds)
    return defaultBounds
  }
}

export const saveBounds = (bounds: Electron.Rectangle | undefined) => {
  storage.set('windowBounds', bounds)
}
