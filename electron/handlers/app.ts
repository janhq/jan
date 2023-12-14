import { app, ipcMain, shell, nativeTheme } from 'electron'
import { ModuleManager } from './../managers/module'
import { join } from 'path'
import { ExtensionManager } from './../managers/extension'
import { WindowManager } from './../managers/window'
import { userSpacePath } from './../utils/path'
import { AppRoute } from '@janhq/core'
import { getResourcePath } from './../utils/path'

export function handleAppIPCs() {
  /**
   * Handles the "setNativeThemeLight" IPC message by setting the native theme source to "light".
   * This will change the appearance of the app to the light theme.
   */
  ipcMain.handle(AppRoute.setNativeThemeLight, () => {
    nativeTheme.themeSource = 'light'
  })

  /**
   * Handles the "setNativeThemeDark" IPC message by setting the native theme source to "dark".
   * This will change the appearance of the app to the dark theme.
   */
  ipcMain.handle(AppRoute.setNativeThemeDark, () => {
    nativeTheme.themeSource = 'dark'
  })

  /**
   * Handles the "setNativeThemeSystem" IPC message by setting the native theme source to "system".
   * This will change the appearance of the app to match the system's current theme.
   */
  ipcMain.handle(AppRoute.setNativeThemeSystem, () => {
    nativeTheme.themeSource = 'system'
  })

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

  ipcMain.handle(AppRoute.getResourcePath, async (_event) => {
    return getResourcePath()
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
