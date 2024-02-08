import { ipcMain } from 'electron'

import { getJanDataFolderPath, normalizeFilePath } from '@janhq/core/node'
import { FileSystemRoute } from '@janhq/core'
import { join } from 'path'
/**
 * Handles file system operations.
 */
export function handleFsIPCs() {
  const moduleName = 'fs'
  Object.values(FileSystemRoute).forEach((route) => {
    ipcMain.handle(route, async (event, ...args) => {
      return import(moduleName).then((mdl) =>
        mdl[route](
          ...args.map((arg) =>
            typeof arg === 'string' &&
            (arg.startsWith(`file:/`) || arg.startsWith(`file:\\`))
              ? join(getJanDataFolderPath(), normalizeFilePath(arg))
              : arg
          )
        )
      )
    })
  })
}
