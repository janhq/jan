import { app, ipcMain, dialog, shell, nativeTheme } from 'electron'
import { windowManager } from '../managers/window'
import {
  AppEvent,
  NativeRoute,
  SelectFileProp,
  SelectFileOption,
} from '@janhq/core/node'
import { menu } from '../utils/menu'
import { join } from 'path'
import { getJanDataFolderPath } from './../utils/path'
import { readdirSync, readFileSync } from 'fs'

const isMac = process.platform === 'darwin'

export function handleAppIPCs() {
  /**
   * Handles the "setNativeThemeLight" IPC message by setting the native theme source to "light".
   * This will change the appearance of the app to the light theme.
   */
  ipcMain.handle(NativeRoute.setNativeThemeLight, () => {
    nativeTheme.themeSource = 'light'
  })

  ipcMain.handle(NativeRoute.setCloseApp, () => {
    windowManager.mainWindow?.close()
  })

  ipcMain.handle(NativeRoute.setMinimizeApp, () => {
    windowManager.mainWindow?.minimize()
  })

  ipcMain.handle(NativeRoute.homePath, () => {
    // Handles the 'get jan home path' IPC event. This event is triggered to get the default jan home path.
    return join(
      process.env[process.platform == 'win32' ? 'USERPROFILE' : 'HOME'] ?? '',
      'jan'
    )
  })
  ipcMain.handle(NativeRoute.setMaximizeApp, async (_event) => {
    if (windowManager.mainWindow?.isMaximized()) {
      windowManager.mainWindow.unmaximize()
    } else {
      windowManager.mainWindow?.maximize()
    }
  })

  ipcMain.handle(NativeRoute.getThemes, async () => {
    const folderPath = join(await getJanDataFolderPath(), 'themes')
    const installedThemes = await readdirSync(folderPath)

    const themesOptions = Promise.all(
      installedThemes
        .filter((x: string) => x !== '.DS_Store')
        .map(async (x: string) => {
          const y = await join(folderPath, x, `theme.json`)
          const c = JSON.parse(await readFileSync(y, 'utf-8'))
          return { name: c?.displayName, value: c.id }
        })
    )
    return themesOptions
  })

  ipcMain.handle(NativeRoute.readTheme, async (_event, themeId: string) => {
    const folderPath = join(await getJanDataFolderPath(), 'themes')
    const filePath = await join(folderPath, themeId, `theme.json`)
    return JSON.parse(await readFileSync(filePath, 'utf-8'))
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
    app.relaunch()
    app.exit()
  })

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

  ipcMain.handle(
    NativeRoute.hideQuickAskWindow,
    async (): Promise<void> => windowManager.hideQuickAskWindow()
  )

  ipcMain.handle(
    NativeRoute.sendQuickAskInput,
    async (_event, input: string): Promise<void> => {
      windowManager.mainWindow?.webContents.send(
        AppEvent.onUserSubmitQuickAsk,
        input
      )
    }
  )

  ipcMain.handle(NativeRoute.showOpenMenu, function (e, args) {
    if (!isMac && windowManager.mainWindow) {
      menu.popup({
        window: windowManager.mainWindow,
        x: args.x,
        y: args.y,
      })
    }
  })

  ipcMain.handle(
    NativeRoute.hideMainWindow,
    async (): Promise<void> => windowManager.hideMainWindow()
  )

  ipcMain.handle(
    NativeRoute.showMainWindow,
    async (): Promise<void> => windowManager.showMainWindow()
  )

  ipcMain.handle(
    NativeRoute.quickAskSizeUpdated,
    async (_event, heightOffset: number): Promise<void> =>
      windowManager.expandQuickAskWindow(heightOffset)
  )

  ipcMain.handle(NativeRoute.ackDeepLink, async (_event): Promise<void> => {
    windowManager.ackDeepLink()
  })
}
