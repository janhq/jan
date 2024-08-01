import { app, BrowserWindow } from 'electron'

import { join, resolve } from 'path'
import { exec } from 'child_process'
import { cortexPath } from './cortex-runner'

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
import { setupMenu } from './utils/menu'
import { createUserSpace } from './utils/path'
import { migrate } from './utils/migration'
import { cleanUpAndQuit } from './utils/clean'
import { setupCore } from './utils/setup'
import { setupReactDevTool } from './utils/dev'

import log from 'electron-log'

const preloadPath = join(__dirname, 'preload.js')
const rendererPath = join(__dirname, '..', 'renderer')
const mainPath = join(rendererPath, 'index.html')

const mainUrl = 'http://localhost:3000'

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

log.initialize()
log.info('Log from the main process')

// replace all console.log to log
Object.assign(console, log.functions)

app
  .whenReady()
  .then(() => {
    const command = `${cortexPath} -a 127.0.0.1 -p 1337`

    log.info('Starting cortex with command:', command)
    // init cortex
    exec(`${command}`, (error, stdout, stderr) => {
      if (error) {
        log.error(`error: ${error.message}`)
        return
      }
      if (stderr) {
        log.error(`stderr: ${stderr}`)
        return
      }
      log.info(`stdout: ${stdout}`)
    })
  })
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
  .then(setupMenu)
  .then(handleIPCs)
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

app.once('quit', async () => {
  await stopApiServer()
  cleanUpAndQuit()
})

app.once('window-all-closed', async () => {
  await stopApiServer()
  cleanUpAndQuit()
})

async function stopApiServer() {
  try {
    console.log('Stopping API server')
    const response = await fetch('http://localhost:1337/v1/system', {
      method: 'DELETE',
    })

    console.log('Response status:', response.status)
  } catch (error) {
    console.error('Error stopping API server:', error)
  }
}

/**
 * Handles various IPC messages from the renderer process.
 */
function handleIPCs() {
  // Inject core handlers for IPCs
  // Handle native IPCs
  handleAppIPCs()
}

/**
 * Suppress Node error messages
 */
process.on('uncaughtException', function (err) {
  log.error(`Error: ${err}`)
})
