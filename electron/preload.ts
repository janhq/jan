/**
 * Exposes a set of APIs to the renderer process via the contextBridge object.
 * @module preload
 */

import {
  AppEvent,
  AppRoute,
  DownloadEvent,
  DownloadRoute,
  ExtensionRoute,
  FileSystemRoute,
} from '@janhq/core'
const { contextBridge } = require('electron')

const { ipcRenderer } = require('electron')
const ipcMethods = [
  ...Object.values(AppRoute),
  ...Object.values(DownloadRoute),
  ...Object.values(ExtensionRoute),
  ...Object.values(FileSystemRoute),
]

const ipcEvents = [...Object.values(AppEvent), ...Object.values(DownloadEvent)]

const interfaces: { [key: string]: (...args: any[]) => any } = {}

ipcMethods.forEach((method) => {
  interfaces[method] = (...args: any[]) => ipcRenderer.invoke(method, ...args)
})

ipcEvents.forEach((method) => {
  interfaces[method] = (handler: any) => ipcRenderer.on(method, handler)
})

contextBridge.exposeInMainWorld('electronAPI', {
  ...interfaces,
})
