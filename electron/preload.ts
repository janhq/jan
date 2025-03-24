/**
 * Exposes a set of APIs to the renderer process via the contextBridge object.
 * @module preload
 */

import { APIEvents, APIRoutes, AppConfiguration } from '@janhq/core/node'
import { contextBridge, ipcRenderer } from 'electron'
import { readdirSync } from 'fs'

const interfaces: { [key: string]: (...args: any[]) => any } = {}

// Loop over each route in APIRoutes
APIRoutes.forEach((method) => {
  // For each method, create a function on the interfaces object
  // This function invokes the method on the ipcRenderer with any provided arguments

  interfaces[method] = (...args: any[]) => ipcRenderer.invoke(method, ...args)
})

// Loop over each method in APIEvents
APIEvents.forEach((method) => {
  // For each method, create a function on the interfaces object
  // This function sets up an event listener on the ipcRenderer for the method
  // The handler for the event is provided as an argument to the function
  interfaces[method] = (handler: any) => ipcRenderer.on(method, handler)
})

interfaces['changeDataFolder'] = async (path) => {
  const appConfiguration: AppConfiguration = await ipcRenderer.invoke(
    'getAppConfigurations'
  )
  const currentJanDataFolder = appConfiguration.data_folder
  appConfiguration.data_folder = path
  const reflect = require('@alumna/reflect')
  const { err } = await reflect({
    src: currentJanDataFolder,
    dest: path,
    recursive: true,
    delete: false,
    overwrite: true,
    errorOnExist: false,
  })
  if (err) {
    console.error(err)
    throw err
  }
  await ipcRenderer.invoke('updateAppConfiguration', appConfiguration)
}

interfaces['isDirectoryEmpty'] = async (path) => {
  const dirChildren = await readdirSync(path)
  return dirChildren.filter((x) => x !== '.DS_Store').length === 0
}

// Expose the 'interfaces' object in the main world under the name 'electronAPI'
// This allows the renderer process to access these methods directly
contextBridge.exposeInMainWorld('electronAPI', {
  ...interfaces,
  isQuickAsk: () => false,
})
