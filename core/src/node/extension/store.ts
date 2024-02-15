import { writeFileSync } from 'fs'
import Extension from './extension'
import { ExtensionManager } from './manager'

/**
 * @module store
 * @private
 */

/**
 * Register of installed extensions
 * @type {Object.<string, Extension>} extension - List of installed extensions
 */
const extensions: Record<string, Extension> = {}

/**
 * Get a extension from the stored extensions.
 * @param {string} name Name of the extension to retrieve
 * @returns {Extension} Retrieved extension
 * @alias extensionManager.getExtension
 */
export function getExtension(name: string) {
  if (!Object.prototype.hasOwnProperty.call(extensions, name)) {
    throw new Error(`Extension ${name} does not exist`)
  }

  return extensions[name]
}

/**
 * Get list of all extension objects.
 * @returns {Array.<Extension>} All extension objects
 * @alias extensionManager.getAllExtensions
 */
export function getAllExtensions() {
  return Object.values(extensions)
}

/**
 * Get list of active extension objects.
 * @returns {Array.<Extension>} Active extension objects
 * @alias extensionManager.getActiveExtensions
 */
export function getActiveExtensions() {
  return Object.values(extensions).filter((extension) => extension.active)
}

/**
 * Remove extension from store and maybe save stored extensions to file
 * @param {string} name Name of the extension to remove
 * @param {boolean} persist Whether to save the changes to extensions to file
 * @returns {boolean} Whether the delete was successful
 * @alias extensionManager.removeExtension
 */
export function removeExtension(name: string, persist = true) {
  const del = delete extensions[name]
  if (persist) persistExtensions()
  return del
}

/**
 * Add extension to store and maybe save stored extensions to file
 * @param {Extension} extension Extension to add to store
 * @param {boolean} persist Whether to save the changes to extensions to file
 * @returns {void}
 */
export function addExtension(extension: Extension, persist = true) {
  if (extension.name) extensions[extension.name] = extension
  if (persist) {
    persistExtensions()
    extension.subscribe('pe-persist', persistExtensions)
  }
}

/**
 * Save stored extensions to file
 * @returns {void}
 */
export function persistExtensions() {
  const persistData: Record<string, Extension> = {}
  for (const name in extensions) {
    persistData[name] = extensions[name]
  }
  writeFileSync(ExtensionManager.instance.getExtensionsFile(), JSON.stringify(persistData))
}

/**
 * Create and install a new extension for the given specifier.
 * @param {Array.<installOptions | string>} extensions A list of NPM specifiers, or installation configuration objects.
 * @param {boolean} [store=true] Whether to store the installed extensions in the store
 * @returns {Promise.<Array.<Extension>>} New extension
 * @alias extensionManager.installExtensions
 */
export async function installExtensions(extensions: any) {
  const installed: Extension[] = []
  for (const ext of extensions) {
    // Set install options and activation based on input type
    const isObject = typeof ext === 'object'
    const spec = isObject ? [ext.specifier, ext] : [ext]
    const activate = isObject ? ext.activate !== false : true

    // Install and possibly activate extension
    const extension = new Extension(...spec)
    if (!extension.origin) {
      continue
    }
    await extension._install()
    if (activate) extension.setActive(true)

    // Add extension to store if needed
    addExtension(extension)
    installed.push(extension)
  }

  // Return list of all installed extensions
  return installed
}

/**
 * @typedef {Object.<string, any>} installOptions The {@link https://www.npmjs.com/package/pacote|pacote}
 * options used to install the extension with some extra options.
 * @param {string} specifier the NPM specifier that identifies the package.
 * @param {boolean} [activate] Whether this extension should be activated after installation. Defaults to true.
 */
