import { app, ipcMain, shell } from 'electron'
import { join, basename } from 'path'
import { WindowManager } from './../managers/window'
import { getResourcePath, userSpacePath } from './../utils/path'
import { AppRoute } from '@janhq/core'
import { ModuleManager, init, log } from '@janhq/core/node'
import { startServer, stopServer } from '@janhq/server'

export function handleAppIPCs() {
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
   * Start Jan API Server.
   */
  ipcMain.handle(AppRoute.startServer, async (_event) =>
    startServer(
      app.isPackaged
        ? join(getResourcePath(), 'docs', 'openapi', 'jan.yaml')
        : undefined,
      app.isPackaged ? join(getResourcePath(), 'docs', 'openapi') : undefined
    )
  )

  /**
   * Stop Jan API Server.
   */
  ipcMain.handle(AppRoute.stopServer, async (_event) => stopServer())

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
      init({
        // Function to check from the main process that user wants to install a extension
        confirmInstall: async (_extensions: string[]) => {
          return true
        },
        // Path to install extension to
        extensionsPath: join(userSpacePath, 'extensions'),
      })
      WindowManager.instance.currentWindow?.reload()
    }
  })

  /**
   * Log message to log file.
   */
  ipcMain.handle(AppRoute.log, async (_event, message, fileName) =>
    log(message, fileName)
  )
}
