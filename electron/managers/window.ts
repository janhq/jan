import { BrowserWindow, app, shell } from 'electron'
import { quickAskWindowConfig } from './quickAskWindowConfig'
import { mainWindowConfig } from './mainWindowConfig'
import { getAppConfigurations, AppEvent } from '@janhq/core/node'

/**
 * Manages the current window instance.
 */
// TODO: refactor this
let isAppQuitting = false
class WindowManager {
  public mainWindow?: BrowserWindow
  private _quickAskWindow: BrowserWindow | undefined = undefined
  private _quickAskWindowVisible = false
  private _mainWindowVisible = false

  /**
   * Creates a new window instance.
   * @param {Electron.BrowserWindowConstructorOptions} options - The options to create the window with.
   * @returns The created window instance.
   */
  createMainWindow(preloadPath: string, startUrl: string) {
    this.mainWindow = new BrowserWindow({
      ...mainWindowConfig,
      webPreferences: {
        nodeIntegration: true,
        preload: preloadPath,
        webSecurity: false,
      },
    })

    /* Load frontend app to the window */
    this.mainWindow.loadURL(startUrl)

    /* Open external links in the default browser */
    this.mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url)
      return { action: 'deny' }
    })

    app.on('before-quit', function () {
      isAppQuitting = true
    })

    windowManager.mainWindow?.on('close', function (evt) {
      // Feature Toggle for Quick Ask
      if (!getAppConfigurations().quick_ask) return

      if (!isAppQuitting) {
        evt.preventDefault()
        windowManager.hideMainWindow()
      }
    })
  }

  createQuickAskWindow(preloadPath: string, startUrl: string): void {
    this._quickAskWindow = new BrowserWindow({
      ...quickAskWindowConfig,
      webPreferences: {
        nodeIntegration: true,
        preload: preloadPath,
        webSecurity: false,
      },
    })

    this._quickAskWindow.loadURL(startUrl)
    this._quickAskWindow.on('blur', () => {
      this.hideQuickAskWindow()
    })
  }

  isMainWindowVisible(): boolean {
    return this._mainWindowVisible
  }

  hideMainWindow(): void {
    this.mainWindow?.hide()
    this._mainWindowVisible = false
  }

  showMainWindow(): void {
    this.mainWindow?.show()
    this._mainWindowVisible = true
  }

  hideQuickAskWindow(): void {
    this._quickAskWindow?.hide()
    this._quickAskWindowVisible = false
  }

  showQuickAskWindow(): void {
    this._quickAskWindow?.show()
    this._quickAskWindowVisible = true
  }

  closeQuickAskWindow(): void {
    this._quickAskWindow?.close()
    this._quickAskWindow?.destroy()
    this._quickAskWindowVisible = false
  }

  isQuickAskWindowVisible(): boolean {
    return this._quickAskWindowVisible
  }

  isQuickAskWindowDestroyed(): boolean {
    return this._quickAskWindow?.isDestroyed() ?? true
  }

  expandQuickAskWindow(heightOffset: number): void {
    const width = quickAskWindowConfig.width!
    const height = quickAskWindowConfig.height! + heightOffset
    this._quickAskWindow?.setMinimumSize(width, height)
    this._quickAskWindow?.setSize(width, height, true)
  }

  sendQuickAskSelectedText(selectedText: string): void {
    this._quickAskWindow?.webContents.send(
      AppEvent.onSelectedText,
      selectedText
    )
  }

  cleanUp(): void {
    this.mainWindow?.close()
    this.mainWindow?.destroy()
    this.mainWindow = undefined
    this._quickAskWindow?.close()
    this._quickAskWindow?.destroy()
    this._quickAskWindow = undefined
    this._quickAskWindowVisible = false
    this._mainWindowVisible = false
  }
}

export const windowManager = new WindowManager()
