import { app, ipcMain, shell, nativeTheme } from 'electron'
import { join, basename } from 'path'
import { WindowManager } from './../managers/window'
import { userSpacePath } from './../utils/path'
import { AppRoute } from '@janhq/core'
import { ExtensionManager, ModuleManager } from '@janhq/core/node'

export function handleAppIPCs() {
  /**
   * Returns the version of the app.
   * @param _event - The IPC event object.
   * @returns The version of the app.
   */
  ipcMain.handle(AppRoute.appVersion, async (_event) => {
    return app.getVersion()
  })

  /**
   * Handles the "openAppDirectory" IPC message by opening the app's user data directory.
   * The `shell.openPath` method is used to open the directory in the user's default file explorer.
   * @param _event - The IPC event object.
   */
  ipcMain.handle(AppRoute.openAppDirectory, async (_event) => {
    shell.openPath(userSpacePath)
  })

  /**
   * Opens a URL in the user's default browser.
   * @param _event - The IPC event object.
   * @param url - The URL to open.
   */
  ipcMain.handle(AppRoute.openExternalUrl, async (_event, url) => {
    shell.openExternal(url)
  })

  /**
   * Opens a URL in the user's default browser.
   * @param _event - The IPC event object.
   * @param url - The URL to open.
   */
  ipcMain.handle(AppRoute.openFileExplore, async (_event, url) => {
    shell.openPath(url)
  })

  /**
   * Joins multiple paths together, respect to the current OS.
   */
  ipcMain.handle(AppRoute.joinPath, async (_event, paths: string[]) =>
    join(...paths)
  )

  /**
   * Retrieve basename from given path, respect to the current OS.
   */
  ipcMain.handle(AppRoute.baseName, async (_event, path: string) =>
    basename(path)
  )

  /**
   * Relaunches the app in production - reload window in development.
   * @param _event - The IPC event object.
   * @param url - The URL to reload.
   */
  ipcMain.handle(AppRoute.relaunch, async (_event, url) => {
    ModuleManager.instance.clearImportedModules()

    if (app.isPackaged) {
      app.relaunch()
      app.exit()
    } else {
      for (const modulePath in ModuleManager.instance.requiredModules) {
        delete require.cache[
          require.resolve(join(userSpacePath, 'extensions', modulePath))
        ]
      }
      ExtensionManager.instance.setupExtensions()
      WindowManager.instance.currentWindow?.reload()
    }
  })
}
