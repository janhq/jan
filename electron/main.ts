import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { setupMenu } from './utils/menu'
import { createUserSpace } from './utils/path'

/**
 * Managers
 **/
import { WindowManager } from './managers/window'
import { ExtensionManager, ModuleManager } from '@janhq/core/node'

/**
 * IPC Handlers
 **/
import { handleDownloaderIPCs } from './handlers/download'
import { handleExtensionIPCs } from './handlers/extension'
import { handleFileMangerIPCs } from './handlers/fileManager'
import { handleAppIPCs } from './handlers/app'
import { handleAppUpdates } from './handlers/update'
import { handleFsIPCs } from './handlers/fs'
import { migrateExtensions } from './utils/migration'

/**
 * Server
 */
import { startServer } from '@janhq/server'

app
  .whenReady()
  .then(createUserSpace)
  .then(migrateExtensions)
  .then(ExtensionManager.instance.setupExtensions)
  .then(setupMenu)
  .then(handleIPCs)
  .then(handleAppUpdates)
  .then(createMainWindow)
  .then(startServer)
  .then(() => {
    app.on('activate', () => {
      if (!BrowserWindow.getAllWindows().length) {
        createMainWindow()
      }
    })
  })

app.on('window-all-closed', () => {
  ModuleManager.instance.clearImportedModules()
  app.quit()
})

app.on('quit', () => {
  ModuleManager.instance.clearImportedModules()
  app.quit()
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

  /* Enable dev tools for development */
  if (!app.isPackaged) mainWindow.webContents.openDevTools()
}

/**
 * Handles various IPC messages from the renderer process.
 */
function handleIPCs() {
  handleFsIPCs()
  handleDownloaderIPCs()
  handleExtensionIPCs()
  handleAppIPCs()
  handleFileMangerIPCs()
}
