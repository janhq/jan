import { app } from 'electron'

export const setupReactDevTool = async () => {
  if (!app.isPackaged) {
    // Which means you're running from source code
    const { default: installExtension, REACT_DEVELOPER_TOOLS } = await import(
      'electron-devtools-installer'
    ) // Don't use import on top level, since the installer package is dev-only
    try {
      const name = await installExtension(REACT_DEVELOPER_TOOLS)
      console.debug(`Added Extension: ${name}`)
    } catch (err) {
      console.error('An error occurred while installing devtools:', err)
      // Only log the error and don't throw it because it's not critical
    }
  }
}
