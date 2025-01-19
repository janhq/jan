import { app, BrowserWindow } from 'electron'

import { join, resolve } from 'path'
/**
 * Managers
 **/
import { windowManager } from './managers/window'

/**
 * IPC Handlers
 **/
import { injectHandler } from './handlers/common'
import { handleAppUpdates } from './handlers/update'
import { handleAppIPCs } from './handlers/native'

/**
 * Utils
 **/
import { setupMenu } from './utils/menu'
import { createUserSpace } from './utils/path'
import { migrate } from './utils/migration'
import { cleanUpAndQuit } from './utils/clean'
import { setupExtensions } from './utils/extension'
import { setupCore } from './utils/setup'
import { setupReactDevTool } from './utils/dev'

import { trayManager } from './managers/tray'
import { logSystemInfo } from './utils/system'
import { registerGlobalShortcuts } from './utils/shortcut'
import { log } from '@janhq/core/node'

const preloadPath = join(__dirname, 'preload.js')
const rendererPath = join(__dirname, '..', 'renderer')
const quickAskPath = join(rendererPath, 'search.html')
const mainPath = join(rendererPath, 'index.html')

const mainUrl = 'http://localhost:3000'
const quickAskUrl = `${mainUrl}/search`

const gotTheLock = app.requestSingleInstanceLock()

if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('jan', process.execPath, [
      resolve(process.argv[1]),
    ])
  }
} else {
  app.setAsDefaultProtocolClient('jan')
}

const createMainWindow = () => {
  const startUrl = app.isPackaged ? `file://${mainPath}` : mainUrl
  windowManager.createMainWindow(preloadPath, startUrl)
}

app
  .whenReady()
  .then(() => {
    if (!gotTheLock) {
      app.quit()
      throw new Error('Another instance of the app is already running')
    } else {
      app.on(
        'second-instance',
        (_event, commandLine, _workingDirectory): void => {
          if (process.platform === 'win32' || process.platform === 'linux') {
            // this is for handling deeplink on windows and linux
            // since those OS will emit second-instance instead of open-url
            const url = commandLine.pop()
            if (url) {
              windowManager.sendMainAppDeepLink(url)
            }
          }
          windowManager.showMainWindow()
        }
      )
    }
  })
  .then(setupCore)
  .then(createUserSpace)
  .then(migrate)
  .then(setupExtensions)
  .then(setupMenu)
  .then(handleIPCs)
  .then(handleAppUpdates)
  .then(() => process.env.CI !== 'e2e' && createQuickAskWindow())
  .then(createMainWindow)
  .then(registerGlobalShortcuts)
  .then(() => {
    if (!app.isPackaged) {
      setupReactDevTool()
      windowManager.mainWindow?.webContents.openDevTools()
    }
  })
  .then(logSystemInfo)
  .then(() => {
    app.on('activate', () => {
      if (!BrowserWindow.getAllWindows().length) {
        createMainWindow()
      } else {
        windowManager.showMainWindow()
      }
    })
  })

app.on('open-url', (_event, url) => {
  windowManager.sendMainAppDeepLink(url)
})

app.on('before-quit', function (_event) {
  trayManager.destroyCurrentTray()
})

app.once('quit', () => {
  cleanUpAndQuit()
})

app.once('window-all-closed', () => {
  // Feature Toggle for Quick Ask
  if (!windowManager.isQuickAskWindowDestroyed()) return
  cleanUpAndQuit()
})

function createQuickAskWindow() {
  // Feature Toggle for Quick Ask
  const startUrl = app.isPackaged ? `file://${quickAskPath}` : quickAskUrl
  windowManager.createQuickAskWindow(preloadPath, startUrl)
}

/**
 * Handles various IPC messages from the renderer process.
 */
function handleIPCs() {
  // Inject core handlers for IPCs
  injectHandler()

  // Handle native IPCs
  handleAppIPCs()
}

/*
 ** Suppress Node error messages
 */
process.on('uncaughtException', function (err) {
  log(`Error: ${err}`)
})
