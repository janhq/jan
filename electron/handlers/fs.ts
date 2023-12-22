import { ipcMain } from 'electron'

import { FileSystemRoute } from '@janhq/core'
import { userSpacePath } from '../utils/path'
import { join } from 'path'
/**
 * Handles file system operations.
 */
export function handleFsIPCs() {
  Object.values(FileSystemRoute).forEach((route) => {
    const moduleName = "fs"
    ipcMain.handle(route, async (event, ...args) => {
      return import(moduleName).then(mdl => 
         { return mdl[route](
        ...args.map((arg) =>
          arg.includes('file:/')
            ? join(userSpacePath, arg.replace('file:/', ''))
            : arg
        ))}
      )
    })
  })
}
