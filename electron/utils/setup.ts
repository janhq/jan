import { app } from 'electron'
import Store from 'electron-store'
import { existsSync, readFileSync } from 'original-fs'
import { appResourcePath } from './path'
import { join } from 'path'
const DEFAULT_WIDTH = 1000
const DEFAULT_HEIGHT = 800

const storage = new Store()

export const setupCore = async () => {
  let cortexVersion = 'N/A'
  // Read package.json
  const pkgPath = join(await appResourcePath(), 'package.json')
  if(existsSync(pkgPath)) {
     const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
    cortexVersion = pkg.dependencies['cortexso']
  }
  // Setup core api for main process
  global.core = {
    // Define appPath function for app to retrieve app path globally
    appPath: () => app.getPath('userData'),
    cortexVersion: () => cortexVersion,
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
