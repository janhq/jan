/**
 * Exposes a set of APIs to the renderer process via the contextBridge object.
 * @module preload
 */

import { APIEvents, APIRoutes } from '@janhq/core/node'
import { contextBridge, ipcRenderer } from 'electron'

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

// Expose the 'interfaces' object in the main world under the name 'electronAPI'
// This allows the renderer process to access these methods directly
contextBridge.exposeInMainWorld('electronAPI', {
  ...interfaces,
  isQuickAsk: () => true,
})
