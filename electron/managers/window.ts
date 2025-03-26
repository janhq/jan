import { BrowserWindow, app, shell, Menu, MenuItem } from 'electron'
import { quickAskWindowConfig } from './quickAskWindowConfig'
import { mainWindowConfig } from './mainWindowConfig'
import { getAppConfigurations, AppEvent } from '@janhq/core/node'
import { getBounds, saveBounds } from '../utils/setup'

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

  private deeplink: string | undefined
  /**
   * Creates a new window instance.
   * @returns The created window instance.
   */
  async createMainWindow(preloadPath: string, startUrl: string) {
    const bounds = await getBounds()

    this.mainWindow = new BrowserWindow({
      ...mainWindowConfig,
      width: bounds.width,
      height: bounds.height,
      show: false,
      x: bounds.x,
      y: bounds.y,
      webPreferences: {
        nodeIntegration: true,
        preload: preloadPath,
        webSecurity: false,
        spellcheck: true,
      },
    })

    // Enable spell checker
    // TODO: should use SpellCheckerAtom to determine this.
    // Need to determine which language to use as well.

    // An array of all available language codes
    // const possibleLanguages = myWindow.webContents.session.availableSpellCheckerLanguages

    this.mainWindow.webContents.session.setSpellCheckerEnabled(true)
    this.mainWindow.webContents.session.setSpellCheckerLanguages(['en-US'])

    // NOTE: This doesn't work right now but could given the ability to actually
    // run the app locally.
    this.mainWindow.webContents.on('context-menu', (event, params) => {
      // TODO: if event is right-clicking on a spelling error, show context menu
      // else: don't show menu.

      const menu = new Menu()
    
      // Add each spelling suggestion
      for (const suggestion of params.dictionarySuggestions) {
        menu.append(new MenuItem({
          label: suggestion,
          click: () => this.mainWindow?.webContents.replaceMisspelling(suggestion)
        }))
      }
    
      // Allow users to add the misspelled word to the dictionary
      if (params.misspelledWord) {
        menu.append(
          new MenuItem({
            label: 'Add to dictionary',
            click: () => this.mainWindow?.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord)
          })
        )
      }
    
      menu.popup()
    })

    if (process.platform === 'win32' || process.platform === 'linux') {
      /// This is work around for windows deeplink.
      /// second-instance event is not fired when app is not open, so the app
      /// does not received the deeplink.
      const commandLine = process.argv.slice(1)
      if (commandLine.length > 0) {
        const url = commandLine[0]
        this.sendMainAppDeepLink(url)
      }
    }

    this.mainWindow.on('resized', () => {
      saveBounds(this.mainWindow?.getBounds())
    })

    this.mainWindow.on('moved', () => {
      saveBounds(this.mainWindow?.getBounds())
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

    windowManager.mainWindow?.on('ready-to-show', function () {
      windowManager.mainWindow?.show()
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
    if (this._quickAskWindow?.isDestroyed()) return
    this._quickAskWindow?.close()
    this._quickAskWindow?.destroy()
    this._quickAskWindow = undefined
    this._quickAskWindowVisible = false
  }

  isQuickAskWindowVisible(): boolean {
    return this._quickAskWindowVisible
  }

  isQuickAskWindowDestroyed(): boolean {
    return this._quickAskWindow?.isDestroyed() ?? true
  }

  /**
   * Expand the quick ask window
   */
  expandQuickAskWindow(heightOffset: number): void {
    const width = quickAskWindowConfig.width!
    const height = quickAskWindowConfig.height! + heightOffset
    this._quickAskWindow?.setMinimumSize(width, height)
    this._quickAskWindow?.setSize(width, height, true)
  }

  /**
   * Send the selected text to the quick ask window.
   */
  sendQuickAskSelectedText(selectedText: string): void {
    this._quickAskWindow?.webContents.send(
      AppEvent.onSelectedText,
      selectedText
    )
  }

  /**
   * Try to send the deep link to the main app.
   */
  sendMainAppDeepLink(url: string): void {
    this.deeplink = url
    const interval = setInterval(() => {
      if (!this.deeplink) clearInterval(interval)
      const mainWindow = this.mainWindow
      if (mainWindow) {
        mainWindow.webContents.send(AppEvent.onDeepLink, this.deeplink)
        if (mainWindow.isMinimized()) mainWindow.restore()
        mainWindow.focus()
      }
    }, 500)
  }

  /**
   *  Send main view state to the main app.
   */
  sendMainViewState(route: string) {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(AppEvent.onMainViewStateChange, route)
    }
  }

  /**
   * Clean up all windows.
   */
  cleanUp(): void {
    if (!this.mainWindow?.isDestroyed()) {
      this.mainWindow?.close()
      this.mainWindow?.destroy()
      this.mainWindow = undefined
      this._mainWindowVisible = false
    }
    if (!this._quickAskWindow?.isDestroyed()) {
      this._quickAskWindow?.close()
      this._quickAskWindow?.destroy()
      this._quickAskWindow = undefined
      this._quickAskWindowVisible = false
    }
  }

  /**
   * Acknowledges that the window has received a deep link. We can remove it.
   */
  ackDeepLink() {
    this.deeplink = undefined
  }
}

export const windowManager = new WindowManager()
