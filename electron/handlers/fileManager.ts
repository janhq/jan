import { ipcMain } from 'electron'
// @ts-ignore
import reflect from '@alumna/reflect'

import { FileManagerRoute } from '@janhq/core'
import { userSpacePath, getResourcePath } from './../utils/path'
import fs from 'fs'
import { join } from 'path'
import { FileStat } from '@janhq/core'

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

  // Handles the 'getUserSpace' IPC event. This event is triggered to get the user space path.
  ipcMain.handle(
    FileManagerRoute.getUserSpace,
    (): Promise<string> => Promise.resolve(userSpacePath)
  )

  // Handles the 'getResourcePath' IPC event. This event is triggered to get the resource path.
  ipcMain.handle(FileManagerRoute.getResourcePath, async (_event) =>
    getResourcePath()
  )

  // handle fs is directory here
  ipcMain.handle(
    FileManagerRoute.fileStat,
    async (_event, path: string): Promise<FileStat | undefined> => {
      const normalizedPath = path
        .replace(`file://`, '')
        .replace(`file:/`, '')
        .replace(`file:\\\\`, '')
        .replace(`file:\\`, '')

      const fullPath = join(userSpacePath, normalizedPath)
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
  
  ipcMain.handle(
    FileManagerRoute.writeBlob,
    async (_event, path: string, data: string): Promise<void> => {
      const normalizedPath = path
        .replace(`file://`, '')
        .replace(`file:/`, '')
        .replace(`file:\\\\`, '')
        .replace(`file:\\`, '')
      try {
        const dataBuffer = Buffer.from(data, 'base64')
        fs.writeFileSync(join(userSpacePath, normalizedPath), dataBuffer)
      } catch (err) {
        console.error(`writeFile ${normalizedPath} result: ${err}`)
      }
    }
  )
}
