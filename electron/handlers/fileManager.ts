import { ipcMain } from 'electron'
// @ts-ignore
import reflect from '@alumna/reflect'

import { FileManagerRoute, FileStat } from '@janhq/core'
import { getResourcePath } from './../utils/path'
import fs from 'fs'
import { join } from 'path'
import { getJanDataFolderPath, normalizeFilePath } from '@janhq/core/node'

/**
 * Handles file system extensions operations.
 */
export function handleFileMangerIPCs() {
  // Handles the 'syncFile' IPC event. This event is triggered to synchronize a file from a source path to a destination path.
  ipcMain.handle(
    FileManagerRoute.syncFile,
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

  // Handles the 'getJanDataFolderPath' IPC event. This event is triggered to get the user space path.
  ipcMain.handle(
    FileManagerRoute.getJanDataFolderPath,
    (): Promise<string> => Promise.resolve(getJanDataFolderPath())
  )

  // Handles the 'getResourcePath' IPC event. This event is triggered to get the resource path.
  ipcMain.handle(FileManagerRoute.getResourcePath, async (_event) =>
    getResourcePath()
  )

  // handle fs is directory here
  ipcMain.handle(
    FileManagerRoute.fileStat,
    async (_event, path: string): Promise<FileStat | undefined> => {
      const normalizedPath = normalizeFilePath(path)

      const fullPath = join(getJanDataFolderPath(), normalizedPath)
      const isExist = fs.existsSync(fullPath)
      if (!isExist) return undefined

      const isDirectory = fs.lstatSync(fullPath).isDirectory()
      const size = fs.statSync(fullPath).size

      const fileStat: FileStat = {
        isDirectory,
        size,
      }

      return fileStat
    }
  )
}
