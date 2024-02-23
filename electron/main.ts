import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'
/**
 * Managers
 **/
import { WindowManager } from './managers/window'
import { log } from '@janhq/core/node'

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
import { migrateExtensions } from './utils/migration'
import { cleanUpAndQuit } from './utils/clean'
import { setupExtensions } from './utils/extension'
import { setupCore } from './utils/setup'
import { setupReactDevTool } from './utils/dev'
import { cleanLogs } from './utils/log'

app
  .whenReady()
  .then(setupReactDevTool)
  .then(setupCore)
  .then(createUserSpace)
  .then(migrateExtensions)
  .then(setupExtensions)
  .then(setupMenu)
  .then(handleIPCs)
  .then(handleAppUpdates)
  .then(createMainWindow)
  .then(() => {
    app.on('activate', () => {
      if (!BrowserWindow.getAllWindows().length) {
        createMainWindow()
      }
    })
  })
  .then(() => cleanLogs())

app.once('window-all-closed', () => {
  cleanUpAndQuit()
})

app.once('quit', () => {
  cleanUpAndQuit()
})

function createMainWindow() {
  /* Create main window */
  const mainWindow = WindowManager.instance.createWindow({
    webPreferences: {
      nodeIntegration: true,
      preload: join(__dirname, 'preload.js'),
      webSecurity: false,
    },
  })

  const startURL = app.isPackaged
    ? `file://${join(__dirname, '..', 'renderer', 'index.html')}`
    : 'http://localhost:3000'

  /* Load frontend app to the window */
  mainWindow.loadURL(startURL)

  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  /* Open external links in the default browser */
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  /* Enable dev tools for development */
  if (!app.isPackaged) mainWindow.webContents.openDevTools()
  log(`Version: ${app.getVersion()}`)
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
