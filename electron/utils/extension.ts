import { getJanExtensionsPath, init } from '@janhq/core/node'

export const setupExtensions = async () => {
  init({
    // Function to check from the main process that user wants to install a extension
    confirmInstall: async (_extensions: string[]) => {
      return true
    },
    // Path to install extension to
    extensionsPath: getJanExtensionsPath(),
  })
}
