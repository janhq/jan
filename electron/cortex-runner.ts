import { app } from 'electron'
import { join as joinPath } from 'path'

import { platform } from 'os'

const getPlatform = (): string => {
  switch (platform()) {
    case 'darwin':
    case 'sunos':
      return 'mac'
    case 'win32':
      return 'win'
    default:
      return 'linux'
  }
}

const resourceFolderName = getPlatform() === 'mac' ? 'Resources' : 'resources'

const execPath = app.isPackaged
  ? joinPath(app.getAppPath(), '..', '..', resourceFolderName, 'bin')
  : joinPath(__dirname, '..', 'resources', getPlatform())

const cortexName = 'cortex'
const cortexBinaryName =
  getPlatform() === 'win' ? `${cortexName}.exe` : cortexName

export const cortexPath = `${joinPath(execPath, cortexBinaryName)}`
