import { app, ipcMain, dialog, shell } from 'electron'
import { join } from 'path'
import { WindowManager } from '../managers/window'
import {
  ModuleManager,
  getJanDataFolderPath,
  getJanExtensionsPath,
  init,
} from '@janhq/core/node'
import { NativeRoute } from '@janhq/core'

export function handleAppIPCs() {
  /**
   * Handles the "openAppDirectory" IPC message by opening the app's user data directory.
   * The `shell.openPath` method is used to open the directory in the user's default file explorer.
   * @param _event - The IPC event object.
   */
  ipcMain.handle(NativeRoute.openAppDirectory, async (_event) => {
    shell.openPath(getJanDataFolderPath())
  })

  /**
   * Opens a URL in the user's default browser.
   * @param _event - The IPC event object.
   * @param url - The URL to open.
   */
  ipcMain.handle(NativeRoute.openExternalUrl, async (_event, url) => {
    shell.openExternal(url)
  })

  /**
   * Opens a URL in the user's default browser.
   * @param _event - The IPC event object.
   * @param url - The URL to open.
   */
  ipcMain.handle(NativeRoute.openFileExplore, async (_event, url) => {
    shell.openPath(url)
  })

  /**
   * Relaunches the app in production - reload window in development.
   * @param _event - The IPC event object.
   * @param url - The URL to reload.
   */
  ipcMain.handle(NativeRoute.relaunch, async (_event) => {
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

  ipcMain.handle(NativeRoute.selectDirectory, async () => {
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

  ipcMain.handle(NativeRoute.selectModelFiles, async () => {
    const mainWindow = WindowManager.instance.currentWindow
    if (!mainWindow) {
      console.error('No main window found')
      return
    }
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: 'Select model files',
      buttonLabel: 'Select',
      properties: ['openFile', 'multiSelections'],
    })
    if (canceled) {
      return
    } else {
      return filePaths
    }
  })
}
