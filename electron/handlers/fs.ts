import { ipcMain } from 'electron'

import { FileSystemRoute } from '@janhq/core'
import { userSpacePath } from '../utils/path'
import { join } from 'path'
const fs = require('fs')
/**
 * Handles file system operations.
 */
export function handleFsIPCs() {
  Object.values(FileSystemRoute).forEach((route) => {
    ipcMain.handle(route, async (event, ...args) => {
      return fs[route](
        ...args.map((arg) =>
          arg.includes('file:/')
            ? join(userSpacePath, arg.replace('file:/', ''))
            : arg
        )
      )
    })
  })
}
