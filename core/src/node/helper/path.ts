import { join } from 'path'

/**
 * Normalize file path
 * Remove all file protocol prefix
 * @param path
 * @returns
 */
export function normalizeFilePath(path: string): string {
  return path.replace(/^(file:[\\/]+)([^:\s]+)$/, '$2')
}

/**
 * App resources path
 * Returns string - The current application directory.
 */
export function appResourcePath() {
  try {
    const electron = require('electron')
    // electron
    if (electron && electron.protocol) {
      let appPath = join(electron.app.getAppPath(), '..', 'app.asar.unpacked')

      if (!electron.app.isPackaged) {
        // for development mode
        appPath = join(electron.app.getAppPath())
      }
      return appPath
    }
  } catch (err) {
    console.error('Electron is not available')
  }

  // server
  return join(global.core.appPath(), '../../..')
}

