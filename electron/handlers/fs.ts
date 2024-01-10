import { ipcMain } from 'electron'

import { FileManagerRoute, FileSystemRoute } from '@janhq/core'
import { userSpacePath } from '../utils/path'
import { join } from 'path'
import fs from 'fs'

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
  }),
    ipcMain.handle(
      FileManagerRoute.writeBlob,
      async (_event, path: string, data: string): Promise<void> => {
        try {
          const dataBuffer = Buffer.from(data, 'base64')
          fs.writeFileSync(join(userSpacePath, path), dataBuffer)
        } catch (err) {
          console.error(`writeFile ${path} result: ${err}`)
        }
      }
    )
}
