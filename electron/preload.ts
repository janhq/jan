/**
 * Exposes a set of APIs to the renderer process via the contextBridge object.
 * @module preload
 */

// TODO: Refactor this file for less dependencies and more modularity
// TODO: Most of the APIs should be done using RestAPIs from extensions

import { fsInvokers } from './invokers/fs'
import { appInvokers } from './invokers/app'
import { downloadInvokers } from './invokers/download'
import { extensionInvokers } from './invokers/extension'

const { contextBridge } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  ...extensionInvokers(),
  ...downloadInvokers(),
  ...fsInvokers(),
  ...appInvokers(),
})
