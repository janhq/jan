import { app, ipcMain, dialog, shell, nativeTheme } from 'electron'
import { autoUpdater } from 'electron-updater'
import { join } from 'path'
import { windowManager } from '../managers/window'
import {
  ModuleManager,
  getJanDataFolderPath,
  getJanExtensionsPath,
  init,
  AppEvent,
  NativeRoute,
  SelectFileProp,
} from '@janhq/core/node'
import { SelectFileOption } from '@janhq/core'
import { menu } from '../utils/menu'
import { migrate } from '../utils/migration'
import { createUserSpace } from '../utils/path'
import { setupExtensions } from '../utils/extension'

const isMac = process.platform === 'darwin'

export function handleAppIPCs() {
  /**
   * Handles the "openAppDirectory" IPC message by opening the app's user data directory.
   * The `shell.openPath` method is used to open the directory in the user's default file explorer.
   * @param _event - The IPC event object.
   */
  ipcMain.handle(NativeRoute.openAppDirectory, async (_event) => {
    shell.openPath(getJanDataFolderPath())
  })

  ipcMain.handle(NativeRoute.appUpdateDownload, async (_event) => {
    autoUpdater.downloadUpdate()
  })

  /**
   * Handles the "setNativeThemeLight" IPC message by setting the native theme source to "light".
   * This will change the appearance of the app to the light theme.
   */
  ipcMain.handle(NativeRoute.setNativeThemeLight, () => {
    nativeTheme.themeSource = 'light'
  })

  /**
   * Handles the "setCloseApp" IPC message by closing the main application window.
   * This effectively closes the application if no other windows are open.
   */
  ipcMain.handle(NativeRoute.setCloseApp, () => {
    windowManager.mainWindow?.close()
  })

  /**
   * Handles the "setMinimizeApp" IPC message by minimizing the main application window.
   * The window will be minimized to the system's taskbar or dock.
   */
  ipcMain.handle(NativeRoute.setMinimizeApp, () => {
    windowManager.mainWindow?.minimize()
  })

  /**
   * Handles the "setMaximizeApp" IPC message. It toggles the maximization state of the main window.
   * If the window is currently maximized, it will be un-maximized (restored to its previous size).
   * If the window is not maximized, it will be maximized to fill the screen.
   * @param _event - The IPC event object.
   */
  ipcMain.handle(NativeRoute.setMaximizeApp, async (_event) => {
    if (windowManager.mainWindow?.isMaximized()) {
      windowManager.mainWindow.unmaximize()
    } else {
      windowManager.mainWindow?.maximize()
    }
  })

  /**
   * Handles the "setNativeThemeDark" IPC message by setting the native theme source to "dark".
   * This will change the appearance of the app to the dark theme.
   */
  ipcMain.handle(NativeRoute.setNativeThemeDark, () => {
    nativeTheme.themeSource = 'dark'
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
      windowManager.mainWindow?.reload()
    }
  })

  /**
   * Handles the "selectDirectory" IPC message to open a dialog for selecting a directory.
   * If no main window is found, logs an error and exits.
   * @returns {string} The path of the selected directory, or nothing if canceled.
   */
  ipcMain.handle(NativeRoute.selectDirectory, async () => {
    const mainWindow = windowManager.mainWindow
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

  /**
   * Handles the "selectFiles" IPC message to open a dialog for selecting files.
   * Allows options for setting the dialog title, button label, and selection properties.
   * Logs an error if no main window is found.
   * @param _event - The IPC event object.
   * @param option - Options for customizing file selection dialog.
   * @returns {string[]} An array of selected file paths, or nothing if canceled.
   */
  ipcMain.handle(
    NativeRoute.selectFiles,
    async (_event, option?: SelectFileOption) => {
      const mainWindow = windowManager.mainWindow
      if (!mainWindow) {
        console.error('No main window found')
        return
      }

      const title = option?.title ?? 'Select files'
      const buttonLabel = option?.buttonLabel ?? 'Select'
      const props: SelectFileProp[] = ['openFile']

      if (option?.allowMultiple) {
        props.push('multiSelections')
      }

      if (option?.selectDirectory) {
        props.push('openDirectory')
      }
      console.debug(`Select files with props: ${props}`)
      const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
        title,
        buttonLabel,
        properties: props,
        filters: option?.filters,
      })

      if (canceled) return

      return filePaths
    }
  )

  /**
   * Handles the "hideQuickAskWindow" IPC message to hide the quick ask window.
   * @returns A promise that resolves when the window is hidden.
   */
  ipcMain.handle(
    NativeRoute.hideQuickAskWindow,
    async (): Promise<void> => windowManager.hideQuickAskWindow()
  )

  /**
   * Handles the "sendQuickAskInput" IPC message to send user input to the main window.
   * @param _event - The IPC event object.
   * @param input - User input string to be sent.
   */
  ipcMain.handle(
    NativeRoute.sendQuickAskInput,
    async (_event, input: string): Promise<void> => {
      windowManager.mainWindow?.webContents.send(
        AppEvent.onUserSubmitQuickAsk,
        input
      )
    }
  )

  /**
   * Handles the "showOpenMenu" IPC message to show the context menu at given coordinates.
   * Only applicable on non-Mac platforms.
   * @param e - The event object.
   * @param args - Contains coordinates where the menu should appear.
   */
  ipcMain.handle(NativeRoute.showOpenMenu, function (e, args) {
    if (!isMac && windowManager.mainWindow) {
      menu.popup({
        window: windowManager.mainWindow,
        x: args.x,
        y: args.y,
      })
    }
  })

  /**
   * Handles the "hideMainWindow" IPC message to hide the main application window.
   * @returns A promise that resolves when the window is hidden.
   */
  ipcMain.handle(
    NativeRoute.hideMainWindow,
    async (): Promise<void> => windowManager.hideMainWindow()
  )

  /**
   * Handles the "showMainWindow" IPC message to show the main application window.
   * @returns A promise that resolves when the window is shown.
   */
  ipcMain.handle(
    NativeRoute.showMainWindow,
    async (): Promise<void> => windowManager.showMainWindow()
  )

  /**
   * Handles the "quickAskSizeUpdated" IPC message to update the size of the quick ask window.
   * Resizes window by the given height offset.
   * @param _event - The IPC event object.
   * @param heightOffset - The amount of height to increase.
   * @returns A promise that resolves when the window is resized.
   */
  ipcMain.handle(
    NativeRoute.quickAskSizeUpdated,
    async (_event, heightOffset: number): Promise<void> =>
      windowManager.expandQuickAskWindow(heightOffset)
  )

  /**
   * Handles the "ackDeepLink" IPC message to acknowledge a deep link.
   * Triggers handling of deep link in the application.
   * @param _event - The IPC event object.
   * @returns A promise that resolves when the deep link is acknowledged.
   */
  ipcMain.handle(NativeRoute.ackDeepLink, async (_event): Promise<void> => {
    windowManager.ackDeepLink()
  })

  /**
   * Handles the "factoryReset" IPC message to reset the application to its initial state.
   * Clears loaded modules, recreates user space, runs migrations, and sets up extensions.
   * @param _event - The IPC event object.
   * @returns A promise that resolves after the reset operations are complete.
   */
  ipcMain.handle(NativeRoute.factoryReset, async (_event): Promise<void> => {
    ModuleManager.instance.clearImportedModules()
    return createUserSpace().then(migrate).then(setupExtensions)
  })

  /**
   * Handles the "startServer" IPC message to start the Jan API server.
   * Initializes and starts server with provided configuration options.
   * @param _event - The IPC event object.
   * @param args - Configuration object containing host, port, CORS settings etc.
   * @returns Promise that resolves when server starts successfully
   */
  ipcMain.handle(
    NativeRoute.startServer,
    async (_event, args): Promise<void> => {
      const { startServer } = require('@janhq/server')
      return startServer({
        host: args?.host,
        port: args?.port,
        isCorsEnabled: args?.isCorsEnabled,
        isVerboseEnabled: args?.isVerboseEnabled,
        prefix: args?.prefix,
      })
    }
  )

  /**
   * Handles the "stopServer" IPC message to stop the Jan API server.
   * Gracefully shuts down the server instance.
   * @param _event - The IPC event object
   * @returns Promise that resolves when server stops successfully
   */
  ipcMain.handle(NativeRoute.stopServer, async (_event): Promise<void> => {
    /**
     * Stop Jan API Server.
     */
    const { stopServer } = require('@janhq/server')
    return stopServer()
  })
}
