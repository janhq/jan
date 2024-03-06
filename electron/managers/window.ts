import { BrowserWindow, shell } from 'electron'
import { quickAskWindowConfig } from './quickAskWindowConfig'
import { AppEvent } from '@janhq/core'
import { mainWindowConfig } from './mainWindowConfig'

/**
 * Manages the current window instance.
 */
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

    this.mainWindow.on('close', (e) => {
      e.preventDefault()
      this.hideMainWindow()
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
    this.hideQuickAskWindow()
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

  isQuickAskWindowVisible(): boolean {
    return this._quickAskWindowVisible
  }

  expandQuickAskWindow(heightOffset: number): void {
    const width = quickAskWindowConfig.width!
    const height = quickAskWindowConfig.height! + heightOffset
    this._quickAskWindow?.setSize(width, height, true)
  }

  shrinkQuickAskWindow(): void {
    const width = quickAskWindowConfig.width!
    const height = quickAskWindowConfig.height!
    this._quickAskWindow?.setSize(width, height, true)
  }

  sendQuickAskSelectedText(selectedText: string): void {
    this._quickAskWindow?.webContents.send(
      AppEvent.onSelectedText,
      selectedText
    )
  }

  cleanUp(): void {
    this.mainWindow?.destroy()
    this._quickAskWindow?.destroy()
    this._quickAskWindowVisible = false
    this._mainWindowVisible = false
  }
}

export const windowManager = new WindowManager()
