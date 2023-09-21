import { readFileSync } from "fs"
import { protocol } from 'electron'
import { normalize } from "path"

import Plugin from "./Plugin"
import { getAllPlugins, removePlugin, persistPlugins, installPlugins, getPlugin, getActivePlugins, addPlugin } from "./store"
import { pluginsPath as storedPluginsPath, setPluginsPath, getPluginsFile, setConfirmInstall } from './globals'
import router from "./router"

/**
 * Sets up the required communication between the main and renderer processes.
 * Additionally sets the plugins up using {@link usePlugins} if a pluginsPath is provided.
 * @param {Object} options configuration for setting up the renderer facade.
 * @param {confirmInstall} [options.confirmInstall] Function to validate that a plugin should be installed. 
 * @param {Boolean} [options.useFacade=true] Whether to make a facade to the plugins available in the renderer.
 * @param {string} [options.pluginsPath] Optional path to the plugins folder.
 * @returns {pluginManager|Object} A set of functions used to manage the plugin lifecycle if usePlugins is provided.
 * @function
 */
export function init(options) {
  if (!Object.prototype.hasOwnProperty.call(options, 'useFacade') || options.useFacade) {
    // Store the confirmInstall function
    setConfirmInstall(options.confirmInstall)
    // Enable IPC to be used by the facade
    router()
  }

  // Create plugins protocol to serve plugins to renderer
  registerPluginProtocol()

  // perform full setup if pluginsPath is provided
  if (options.pluginsPath) {
    return usePlugins(options.pluginsPath)
  }

  return {}

}

/**
 * Create plugins protocol to provide plugins to renderer
 * @private
 * @returns {boolean} Whether the protocol registration was successful
 */
function registerPluginProtocol() {
  return protocol.registerFileProtocol('plugin', (request, callback) => {
    const entry = request.url.substr(8)
    const url = normalize(storedPluginsPath + entry)
    callback({ path: url })
  })
}

/**
 * Set Pluggable Electron up to run from the pluginPath folder if it is provided and
 * load plugins persisted in that folder.
 * @param {string} pluginsPath Path to the plugins folder. Required if not yet set up.
 * @returns {pluginManager} A set of functions used to manage the plugin lifecycle.
 */
export function usePlugins(pluginsPath) {
  if (!pluginsPath) throw Error('A path to the plugins folder is required to use Pluggable Electron')
  // Store the path to the plugins folder
  setPluginsPath(pluginsPath)

  // Remove any registered plugins
  for (const plugin of getAllPlugins()) {
    removePlugin(plugin.name, false)
  }

  // Read plugin list from plugins folder
  const plugins = JSON.parse(readFileSync(getPluginsFile()))
  try {
    // Create and store a Plugin instance for each plugin in list
    for (const p in plugins) {
      loadPlugin(plugins[p])
    }
    persistPlugins()

  } catch (error) {
    // Throw meaningful error if plugin loading fails
    throw new Error('Could not successfully rebuild list of installed plugins.\n'
      + error
      + '\nPlease check the plugins.json file in the plugins folder.')
  }

  // Return the plugin lifecycle functions
  return getStore()
}

/**
 * Check the given plugin object. If it is marked for uninstalling, the plugin files are removed.
 * Otherwise a Plugin instance for the provided object is created and added to the store.
 * @private
 * @param {Object} plg Plugin info
 */
function loadPlugin(plg) {
  // Create new plugin, populate it with plg details and save it to the store
  const plugin = new Plugin()

  for (const key in plg) {
    plugin[key] = plg[key]
  }

  addPlugin(plugin, false)
  plugin.subscribe('pe-persist', persistPlugins)
}

/**
 * Returns the publicly available store functions.
 * @returns {pluginManager} A set of functions used to manage the plugin lifecycle.
 */
export function getStore() {
  if (!storedPluginsPath) {
    throw new Error('The plugin path has not yet been set up. Please run usePlugins before accessing the store')
  }

  return {
    installPlugins,
    getPlugin,
    getAllPlugins,
    getActivePlugins,
    removePlugin,
  }
}
