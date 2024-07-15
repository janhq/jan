import { join, resolve } from 'path'
import { getJanDataFolderPath } from './config'

/**
 * Normalize file path
 * Remove all file protocol prefix
 * @param path
 * @returns
 */
export function normalizeFilePath(path: string): string {
  return path.replace(/^(file:[\\/]+)([^:\s]+)$/, '$2')
}

export async function appResourcePath(): Promise<string> {
  let electron: any = undefined

  try {
    const moduleName = 'electron'
    electron = await import(moduleName)
  } catch (err) {
    console.error('Electron is not available')
  }

  // electron
  if (electron && electron.protocol) {
    let appPath = join(electron.app.getAppPath(), '..', 'app.asar.unpacked')

    if (!electron.app.isPackaged) {
      // for development mode
      appPath = join(electron.app.getAppPath())
    }
    return appPath
  }
  // server
  return join(global.core.appPath(), '../../..')
}

export function validatePath(path: string) {
  const janDataFolderPath = getJanDataFolderPath()
  const absolutePath = resolve(__dirname, path)
  if (!absolutePath.startsWith(janDataFolderPath)) {
    throw new Error(`Invalid path: ${absolutePath}`)
  }
}
