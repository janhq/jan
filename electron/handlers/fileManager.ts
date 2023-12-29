import { ipcMain } from 'electron'
// @ts-ignore
import reflect from '@alumna/reflect'

import { FileManagerRoute } from '@janhq/core'
import { userSpacePath, getResourcePath } from './../utils/path'

/**
 * Handles file system extensions operations.
 */
export function handleFileMangerIPCs() {
  // Handles the 'synceFile' IPC event. This event is triggered to synchronize a file from a source path to a destination path.
  ipcMain.handle(
    FileManagerRoute.synceFile,
    async (_event, src: string, dest: string) => {
      return reflect({
        src,
        dest,
        recursive: true,
        delete: false,
        overwrite: true,
        errorOnExist: false,
      })
    }
  )

  // Handles the 'getUserSpace' IPC event. This event is triggered to get the user space path.
  ipcMain.handle(
    FileManagerRoute.getUserSpace,
    (): Promise<string> => Promise.resolve(userSpacePath)
  )

  // Handles the 'getResourcePath' IPC event. This event is triggered to get the resource path.
  ipcMain.handle(FileManagerRoute.getResourcePath, async (_event) => {
    return getResourcePath()
  })
}
