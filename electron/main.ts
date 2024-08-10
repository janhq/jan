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
import { setupMenu } from './utils/menu'
import {
  appResourcePath,
  createUserSpace,
  getAppConfigurations,
} from './utils/path'
import { migrate } from './utils/migration'
import { cleanUpAndQuit } from './utils/clean'
import { setupCore } from './utils/setup'
import { setupReactDevTool } from './utils/dev'

import log from 'electron-log'

import { start } from 'cortexso'

const preloadPath = join(__dirname, 'preload.js')
const rendererPath = join(__dirname, '..', 'renderer')
const mainPath = join(rendererPath, 'index.html')

const mainUrl = 'http://localhost:3000'

import { readFileSync } from 'node:original-fs'

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
log.info('Starting jan from main thread..')

// replace all console.log to log
Object.assign(console, log.functions)

const cortexJsPort = 1338
const cortexCppPort = 3940
const host = '127.0.0.1'

app
  .whenReady()
  .then(async () => {
    console.debug('Setting up core..')
    if (app.isPackaged) {
      const unpackedResourcePath = await appResourcePath()
      console.debug('Unpacked resource path:', unpackedResourcePath)
      const packageJson = JSON.parse(
        readFileSync(join(unpackedResourcePath, 'package.json'), 'utf8')
      )
      return setupCore(packageJson['dependencies']['cortexso'] ?? 'Not found')
    } else {
      const packageJson = JSON.parse(readFileSync('./package.json', 'utf8'))
      return setupCore(packageJson['dependencies']['cortexso'] ?? 'Not found')
    }
  })
  .then(() => {
    console.debug('Check if another instance is running..')
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
  .then(() => {
    const appConfiguration = getAppConfigurations()
    const janDataFolder = appConfiguration.dataFolderPath

    start('jan', host, cortexJsPort, cortexCppPort, janDataFolder)
  })
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
  cleanUpAndQuit()
})

app.once('window-all-closed', async () => {
  await stopApiServer()
  cleanUpAndQuit()
})

async function stopApiServer() {
  // this function is not meant to be success. It will throw an error.
  try {
    await fetch(`http://${host}:${cortexJsPort}/v1/system`, {
      method: 'DELETE',
    })
  } catch (error) {
    // do nothing
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
