import { app, screen } from 'electron'
import Store from 'electron-store'

const DEFAULT_WIDTH = 1000
const DEFAULT_HEIGHT = 800

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

  const bounds = (await storage.get('windowBounds')) as
    | Electron.Rectangle
    | undefined

  // If no bounds are saved, use the defaults
  if (!bounds) {
    storage.set('windowBounds', defaultBounds)
    return defaultBounds
  }

  // Validate that the bounds are on a valid display
  const displays = screen.getAllDisplays()
  const isValid = displays.some((display) => {
    const { x, y, width, height } = display.bounds
    return (
      bounds.x >= x &&
      bounds.x < x + width &&
      bounds.y >= y &&
      bounds.y < y + height
    )
  })

  // If the position is valid, return the saved bounds, otherwise return default bounds
  if (isValid) {
    return bounds
  } else {
    const primaryDisplay = screen.getPrimaryDisplay()
    const resetBounds = {
      x: primaryDisplay.bounds.x,
      y: primaryDisplay.bounds.y,
      width: DEFAULT_WIDTH,
      height: DEFAULT_HEIGHT,
    }
    storage.set('windowBounds', resetBounds)
    return resetBounds
  }
}

export const saveBounds = (bounds: Electron.Rectangle | undefined) => {
  storage.set('windowBounds', bounds)
}
