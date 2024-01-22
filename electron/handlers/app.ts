import { app, ipcMain, dialog, shell } from 'electron'
import { join, basename } from 'path'
import { WindowManager } from './../managers/window'
import { getResourcePath } from './../utils/path'
import { AppRoute, AppConfiguration } from '@janhq/core'
import { ServerConfig, startServer, stopServer } from '@janhq/server'
import {
  ModuleManager,
  getJanDataFolderPath,
  getJanExtensionsPath,
  init,
  log,
  logServer,
  getAppConfigurations,
  updateAppConfiguration,
} from '@janhq/core/node'

export function handleAppIPCs() {
  /**
   * Handles the "openAppDirectory" IPC message by opening the app's user data directory.
   * The `shell.openPath` method is used to open the directory in the user's default file explorer.
   * @param _event - The IPC event object.
   */
  ipcMain.handle(AppRoute.openAppDirectory, async (_event) => {
    shell.openPath(getJanDataFolderPath())
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
  ipcMain.handle(AppRoute.startServer, async (_event, configs?: ServerConfig) =>
    startServer({
      host: configs?.host,
      port: configs?.port,
      isCorsEnabled: configs?.isCorsEnabled,
      isVerboseEnabled: configs?.isVerboseEnabled,
      schemaPath: app.isPackaged
        ? join(getResourcePath(), 'docs', 'openapi', 'jan.yaml')
        : undefined,
      baseDir: app.isPackaged
        ? join(getResourcePath(), 'docs', 'openapi')
        : undefined,
    })
  )

  /**
   * Stop Jan API Server.
   */
  ipcMain.handle(AppRoute.stopServer, stopServer)

  /**
   * Relaunches the app in production - reload window in development.
   * @param _event - The IPC event object.
   * @param url - The URL to reload.
   */
  ipcMain.handle(AppRoute.relaunch, async (_event) => {
    ModuleManager.instance.clearImportedModules()

    if (app.isPackaged) {
      app.relaunch()
      app.exit()
    } else {
      for (const modulePath in ModuleManager.instance.requiredModules) {
        delete require.cache[
          require.resolve(join(getJanExtensionsPath(), modulePath))
        ]
      }
      init({
        // Function to check from the main process that user wants to install a extension
        confirmInstall: async (_extensions: string[]) => {
          return true
        },
        // Path to install extension to
        extensionsPath: getJanExtensionsPath(),
      })
      WindowManager.instance.currentWindow?.reload()
    }
  })

  /**
   * Log message to log file.
   */
  ipcMain.handle(AppRoute.log, async (_event, message) => log(message))

  /**
   * Log message to log file.
   */
  ipcMain.handle(AppRoute.logServer, async (_event, message) =>
    logServer(message)
  )

  ipcMain.handle(AppRoute.selectDirectory, async () => {
    const mainWindow = WindowManager.instance.currentWindow
    if (!mainWindow) {
      console.error('No main window found')
      return
    }
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: 'Select a folder',
      buttonLabel: 'Select Folder',
      properties: ['openDirectory', 'createDirectory'],
    })
    if (canceled) {
      return
    } else {
      return filePaths[0]
    }
  })

  ipcMain.handle(AppRoute.getAppConfigurations, async () =>
    getAppConfigurations()
  )

  ipcMain.handle(
    AppRoute.updateAppConfiguration,
    async (_event, appConfiguration: AppConfiguration) => {
      await updateAppConfiguration(appConfiguration)
    }
  )
}
