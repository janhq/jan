import { app } from 'electron'

export const setupCore = async () => {
  // Setup core api for main process
  global.core = {
    // Define appPath function for app to retrieve app path globally
    appPath: () => app.getPath('userData'),
  }
}
