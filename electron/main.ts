import { app, BrowserWindow } from 'electron'

import { join, resolve } from 'path'

/**
 * Managers
 **/
import { windowManager } from './managers/window'

/**
 * IPC Handlers
 **/
import { handleAppUpdates } from './handlers/update'
import { handleAppIPCs } from './handlers/native'

/**
 * Utils
 **/
import {
  setupMenu,
  createUserSpace,
  getJanDataFolderPath,
  migrate,
  cleanUpAndQuit,
  setupCore,
  setupReactDevTool,
} from './utils'

import log from 'electron-log'

/**
 * Cortex
 */
import { start } from 'cortexso'
import {
  cortexCppPort,
  cortexJsPort,
  cortexHost,
  cleanCortexProcesses,
} from './utils/cortex'

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
  const preloadPath = join(__dirname, 'preload.js')
  const rendererPath = join(__dirname, '..', 'renderer')
  const mainPath = join(rendererPath, 'index.html')
  const mainUrl = 'http://localhost:3000'
  const startUrl = app.isPackaged ? `file://${mainPath}` : mainUrl
  windowManager.createMainWindow(preloadPath, startUrl)
}

/**
 * App Lifecycle
 */
app
  .whenReady()
  .then(() => {
    const dataFolderPath = join(getJanDataFolderPath(), 'jan.log')
    log.initialize()
    log.info('Starting jan from main thread..')
    log.transports.file.resolvePathFn = () => dataFolderPath
    // replace all console.log to log
    Object.assign(console, log.functions)
  })
  .then(() => setupCore())
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
  .then(() => cleanCortexProcesses())
  .then(() =>
    start(
      'jan',
      cortexHost,
      cortexJsPort,
      cortexCppPort,
      getJanDataFolderPath()
    )
  )
  .then(createUserSpace)
  .then(migrate)
  .then(setupMenu)
  .then(handleAppIPCs)
  .then(handleAppUpdates)
  .then(createMainWindow)
  .then(() => {
    if (!app.isPackaged) {
      setupReactDevTool()
      windowManager.mainWindow?.webContents.openDevTools()
    }
  })
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

app.once('quit', async () => cleanUpAndQuit())

app.once('window-all-closed', async () => cleanUpAndQuit())

/**
 * Handle uncaughtException
 */
process.on('uncaughtException', function (err) {
  log.error(`Error: ${err}`)
  cleanCortexProcesses()
})
