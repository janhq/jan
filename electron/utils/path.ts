import { join } from 'path'
import { app } from 'electron'
import { mkdir } from 'fs-extra'

export async function createUserSpace(): Promise<void> {
  return mkdir(userSpacePath).catch(() => {})
}

export const userSpacePath = join(app.getPath('home'), 'jan')

export function getResourcePath() {
  let appPath = join(app.getAppPath(), '..', 'app.asar.unpacked')

  if (!app.isPackaged) {
    // for development mode
    appPath = join(__dirname, '..', '..')
  }
  return appPath
}
