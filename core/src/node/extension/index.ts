import { readFileSync } from 'fs'

import { normalize } from 'path'

import Extension from './extension'
import {
  getAllExtensions,
  removeExtension,
  persistExtensions,
  installExtensions,
  getExtension,
  getActiveExtensions,
  addExtension,
} from './store'
import { ExtensionManager } from './manager'

export function init(options: any) {
  // Create extensions protocol to serve extensions to renderer
  registerExtensionProtocol()

  // perform full setup if extensionsPath is provided
  if (options.extensionsPath) {
    return useExtensions(options.extensionsPath)
  }

  return {}
}

/**
 * Create extensions protocol to provide extensions to renderer
 * @private
 * @returns {boolean} Whether the protocol registration was successful
 */
async function registerExtensionProtocol() {
  let electron: any = undefined

  try {
    const moduleName = 'electron'
    electron = await import(moduleName)
  } catch (err) {
    console.error('Electron is not available')
  }
  const extensionPath = ExtensionManager.instance.getExtensionsPath()
  if (electron && electron.protocol) {
    return electron.protocol?.registerFileProtocol('extension', (request: any, callback: any) => {
      const entry = request.url.substr('extension://'.length - 1)

      const url = normalize(extensionPath + entry)
      callback({ path: url })
    })
  }
}

/**
 * Set extensions up to run from the extensionPath folder if it is provided and
 * load extensions persisted in that folder.
 * @param {string} extensionsPath Path to the extensions folder. Required if not yet set up.
 * @returns {extensionManager} A set of functions used to manage the extension lifecycle.
 */
export function useExtensions(extensionsPath: string) {
  if (!extensionsPath) throw Error('A path to the extensions folder is required to use extensions')
  // Store the path to the extensions folder
  ExtensionManager.instance.setExtensionsPath(extensionsPath)

  // Remove any registered extensions
  for (const extension of getAllExtensions()) {
    if (extension.name) removeExtension(extension.name, false)
  }

  // Read extension list from extensions folder
  const extensions = JSON.parse(
    readFileSync(ExtensionManager.instance.getExtensionsFile(), 'utf-8')
  )
  try {
    // Create and store a Extension instance for each extension in list
    for (const p in extensions) {
      loadExtension(extensions[p])
    }
    persistExtensions()
  } catch (error) {
    // Throw meaningful error if extension loading fails
    throw new Error(
      'Could not successfully rebuild list of installed extensions.\n' +
        error +
        '\nPlease check the extensions.json file in the extensions folder.'
    )
  }

  // Return the extension lifecycle functions
  return getStore()
}

/**
 * Check the given extension object. If it is marked for uninstalling, the extension files are removed.
 * Otherwise a Extension instance for the provided object is created and added to the store.
 * @private
 * @param {Object} ext Extension info
 */
function loadExtension(ext: any) {
  // Create new extension, populate it with ext details and save it to the store
  const extension = new Extension()

  for (const key in ext) {
    if (Object.prototype.hasOwnProperty.call(ext, key)) {
      // Use Object.defineProperty to set the properties as writable
      Object.defineProperty(extension, key, {
        value: ext[key],
        writable: true,
        enumerable: true,
        configurable: true,
      })
    }
  }
  addExtension(extension, false)
  extension.subscribe('pe-persist', persistExtensions)
}

/**
 * Returns the publicly available store functions.
 * @returns {extensionManager} A set of functions used to manage the extension lifecycle.
 */
export function getStore() {
  if (!ExtensionManager.instance.getExtensionsFile()) {
    throw new Error(
      'The extension path has not yet been set up. Please run useExtensions before accessing the store'
    )
  }

  return {
    installExtensions,
    getExtension,
    getAllExtensions,
    getActiveExtensions,
    removeExtension,
  }
}
