import { init, userSpacePath } from '@janhq/core/node'
import path from 'path'

export const setupExtensions = () => {
  init({
    // Function to check from the main process that user wants to install a extension
    confirmInstall: async (_extensions: string[]) => {
      return true
    },
    // Path to install extension to
    extensionsPath: path.join(userSpacePath, 'extensions'),
  })
}
