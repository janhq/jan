import { ipcMain } from 'electron'

import { FileSystemRoute } from '@janhq/core'
import { userSpacePath } from '../utils/path'
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
            (arg.includes(`file:/`) || arg.includes(`file:\\`))
              ? join(
                  userSpacePath,
                  arg
                    .replace(`file://`, '')
                    .replace(`file:/`, '')
                    .replace(`file:\\\\`, '')
                    .replace(`file:\\`, '')
                )
              : arg
          )
        )
      )
    })
  })
}
