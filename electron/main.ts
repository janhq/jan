import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { setupMenu } from './utils/menu'
import { createUserSpace } from './utils/path'
import Fastify from 'fastify'

/**
 * Managers
 **/
import { WindowManager } from './managers/window'
const {
  ExtensionManager,
  ModuleManager,
} = require('@janhq/core/dist/node/index.cjs')

/**
 * IPC Handlers
 **/
import { handleDownloaderIPCs } from './handlers/download'
import { handleExtensionIPCs } from './handlers/extension'
import { handleAppIPCs } from './handlers/app'
import { handleAppUpdates } from './handlers/update'
import { handleFsIPCs } from './handlers/fs'
import {
  createMessage,
  createThread,
  deleteBuilder,
  downloadModel,
  getBuilder,
  getMessages,
  retrieveBuilder,
  retrieveMesasge,
  updateThread,
} from './api/models'
import { JanApiRouteConfiguration } from './api'

// TODO: refactor this, this API piece of code should not belong here
const version = 'v1'

const fastify = Fastify({
  logger: true,
})

fastify.listen({ port: 1337 }, function (err, address) {
  if (err) {
    fastify.log.error(err)
    process.exit(1)
  }
})

Object.keys(JanApiRouteConfiguration).forEach((key) => {
  fastify.get(`/${version}/${key}`, async (_request) =>
    getBuilder(JanApiRouteConfiguration[key])
  )

  fastify.get(`/${version}/${key}/:id`, async (request: any) =>
    retrieveBuilder(JanApiRouteConfiguration[key], request.params.id)
  )

  fastify.delete(`/${version}/${key}/:id`, async (request: any) =>
    deleteBuilder(JanApiRouteConfiguration[key], request.params.id)
  )
})

// get messages of thread id
fastify.get(`/${version}/threads/:threadId/messages`, async (request: any) =>
  getMessages(request.params.threadId)
)

// retrieve message
fastify.get(
  `/${version}/threads/:threadId/messages/:messageId`,
  async (request: any) =>
    retrieveMesasge(request.params.threadId, request.params.messageId)
)

// create thread
fastify.post(`/${version}/threads`, async (request: any) =>
  createThread(request.body)
)

// create message
fastify.post(`/${version}/threads/:threadId/messages`, async (request: any) =>
  createMessage(request.params.threadId, request.body)
)

// modify thread
fastify.patch(`/${version}/threads/:threadId`, async (request: any) =>
  updateThread(request.params.threadId, request.body)
)

fastify.get(`/${version}/models/download/:modelId`, async (request: any) =>
  downloadModel(request.params.modelId)
)

app
  .whenReady()
  .then(createUserSpace)
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
}
