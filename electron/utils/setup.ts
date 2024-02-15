import { app } from 'electron'

export const setupCore = async () => {
  // Setup core api for main process
  global.core = {
    // Define appPath function for app to retrieve app path globaly
    appPath: () => app.getPath('userData'),
  }
}
