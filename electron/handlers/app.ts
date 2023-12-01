import { app, ipcMain, shell } from 'electron'
import { ModuleManager } from '../managers/module'
import { join } from 'path'
import { ExtensionManager } from '../managers/extension'
import { WindowManager } from '../managers/window'
import { userSpacePath } from '../utils/path'

export function handleAppIPCs() {
  /**
   * Retrieves the path to the app data directory using the `coreAPI` object.
   * If the `coreAPI` object is not available, the function returns `undefined`.
   * @returns A Promise that resolves with the path to the app data directory, or `undefined` if the `coreAPI` object is not available.
   */
  ipcMain.handle('appDataPath', async (_event) => {
    return app.getPath('userData')
  })

  /**
   * Returns the version of the app.
   * @param _event - The IPC event object.
   * @returns The version of the app.
   */
  ipcMain.handle('appVersion', async (_event) => {
    return app.getVersion()
  })

  /**
   * Handles the "openAppDirectory" IPC message by opening the app's user data directory.
   * The `shell.openPath` method is used to open the directory in the user's default file explorer.
   * @param _event - The IPC event object.
   */
  ipcMain.handle('openAppDirectory', async (_event) => {
    shell.openPath(userSpacePath)
  })

  /**
   * Opens a URL in the user's default browser.
   * @param _event - The IPC event object.
   * @param url - The URL to open.
   */
  ipcMain.handle('openExternalUrl', async (_event, url) => {
    shell.openExternal(url)
  })

  /**
   * Relaunches the app in production - reload window in development.
   * @param _event - The IPC event object.
   * @param url - The URL to reload.
   */
  ipcMain.handle('relaunch', async (_event, url) => {
    ModuleManager.instance.clearImportedModules()

    if (app.isPackaged) {
      app.relaunch()
      app.exit()
    } else {
      for (const modulePath in ModuleManager.instance.requiredModules) {
        delete require.cache[
          require.resolve(
            join(userSpacePath, 'extensions', modulePath)
          )
        ]
      }
      ExtensionManager.instance.setupExtensions()
      WindowManager.instance.currentWindow?.reload()
    }
  })
}
