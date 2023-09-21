/**
 * Provides access to the plugins stored by Pluggable Electron
 * @typedef {Object} pluginManager
 * @prop {getPlugin} getPlugin
 * @prop {getAllPlugins} getAllPlugins
 * @prop {getActivePlugins} getActivePlugins
 * @prop {installPlugins} installPlugins
 * @prop {removePlugin} removePlugin
 */

import { writeFileSync } from "fs"
import Plugin from "./Plugin"
import { getPluginsFile } from './globals'

/**
 * @module store
 * @private
 */

/**
 * Register of installed plugins
 * @type {Object.<string, Plugin>} plugin - List of installed plugins
 */
const plugins = {}

/**
 * Get a plugin from the stored plugins.
 * @param {string} name Name of the plugin to retrieve
 * @returns {Plugin} Retrieved plugin
 * @alias pluginManager.getPlugin
 */
export function getPlugin(name) {
  if (!Object.prototype.hasOwnProperty.call(plugins, name)) {
    throw new Error(`Plugin ${name} does not exist`)
  }

  return plugins[name]
}

/**
 * Get list of all plugin objects.
 * @returns {Array.<Plugin>} All plugin objects
 * @alias pluginManager.getAllPlugins
 */
export function getAllPlugins() { return Object.values(plugins) }

/**
 * Get list of active plugin objects.
 * @returns {Array.<Plugin>} Active plugin objects
 * @alias pluginManager.getActivePlugins
 */
export function getActivePlugins() {
  return Object.values(plugins).filter(plugin => plugin.active)
}

/**
 * Remove plugin from store and maybe save stored plugins to file
 * @param {string} name Name of the plugin to remove
 * @param {boolean} persist Whether to save the changes to plugins to file
 * @returns {boolean} Whether the delete was successful
 * @alias pluginManager.removePlugin
 */
export function removePlugin(name, persist = true) {
  const del = delete plugins[name]
  if (persist) persistPlugins()
  return del
}

/**
 * Add plugin to store and maybe save stored plugins to file
 * @param {Plugin} plugin Plugin to add to store
 * @param {boolean} persist Whether to save the changes to plugins to file
 * @returns {void}
 */
export function addPlugin(plugin, persist = true) {
  plugins[plugin.name] = plugin
  if (persist) {
    persistPlugins()
    plugin.subscribe('pe-persist', persistPlugins)
  }
}

/**
 * Save stored plugins to file
 * @returns {void}
 */
export function persistPlugins() {
  const persistData = {}
  for (const name in plugins) {
    persistData[name] = plugins[name]
  }
  writeFileSync(getPluginsFile(), JSON.stringify(persistData), 'utf8')
}

/**
 * Create and install a new plugin for the given specifier.
 * @param {Array.<installOptions | string>} plugins A list of NPM specifiers, or installation configuration objects.
 * @param {boolean} [store=true] Whether to store the installed plugins in the store
 * @returns {Promise.<Array.<Plugin>>} New plugin
 * @alias pluginManager.installPlugins
 */
export async function installPlugins(plugins, store = true) {
  const installed = []
  for (const plg of plugins) {
    // Set install options and activation based on input type
    const isObject = typeof plg === 'object'
    const spec = isObject ? [plg.specifier, plg] : [plg]
    const activate = isObject ? plg.activate !== false : true

    // Install and possibly activate plugin
    const plugin = new Plugin(...spec)
    await plugin._install()
    if (activate) plugin.setActive(true)

    // Add plugin to store if needed
    if (store) addPlugin(plugin)
    installed.push(plugin)
  }

  // Return list of all installed plugins
  return installed
}

/**
 * @typedef {Object.<string, any>} installOptions The {@link https://www.npmjs.com/package/pacote|pacote}
 * options used to install the plugin with some extra options.
 * @param {string} specifier the NPM specifier that identifies the package.
 * @param {boolean} [activate] Whether this plugin should be activated after installation. Defaults to true.
 */