import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { setupMenu } from './utils/menu'
import { handleFsIPCs } from './handlers/fs'

/**
 * Managers
 **/
import { WindowManager } from './managers/window'
import { ModuleManager } from './managers/module'
import { ExtensionManager } from './managers/extension'

/**
 * IPC Handlers
 **/
import { handleDownloaderIPCs } from './handlers/download'
import { handleThemesIPCs } from './handlers/theme'
import { handleExtensionIPCs } from './handlers/extension'
import { handleAppIPCs } from './handlers/app'
import { handleAppUpdates } from './handlers/update'

app
  .whenReady()
  .then(ExtensionManager.instance.migrateExtensions)
  .then(ExtensionManager.instance.setupExtensions)
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
    ? `file://${join(__dirname, '../renderer/index.html')}`
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
  handleThemesIPCs()
  handleExtensionIPCs()
  handleAppIPCs()
}
