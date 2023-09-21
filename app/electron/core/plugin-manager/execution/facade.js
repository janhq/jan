/**
 * Helper functions to access the plugin management in the main process.
 * Note that the facade needs to be imported separately as "pluggable-electron/facade" as described above.
 * It is then available on the global window object as describe in the {@link https://www.electronjs.org/docs/api/context-bridge|Electron documentation}
 * @namespace plugins
 */

import Plugin from "./Plugin"
import { register } from './activation-manager'

/**
 * @typedef {Object.<string, any>} installOptions The {@link https://www.npmjs.com/package/pacote|pacote options}
 * used to install the plugin.
 * @param {string} specifier the NPM specifier that identifies the package.
 * @param {boolean} [activate=true] Whether this plugin should be activated after installation.
 */

/**
 * Install a new plugin.
 * @param {Array.<installOptions | string>} plugins A list of NPM specifiers, or installation configuration objects.
 * @returns {Promise.<Array.<Plugin> | false>} plugin as defined by the main process. Has property cancelled set to true if installation was cancelled in the main process.
 * @alias plugins.install
 */
export async function install(plugins) {
  const plgList = await window.pluggableElectronIpc.install(plugins)
  if (plgList.cancelled) return false
  return plgList.map(plg => {
    const plugin = new Plugin(plg.name, plg.url, plg.activationPoints, plg.active)
    register(plugin)
    return plugin
  })
}

/**
 * Uninstall provided plugins
 * @param {Array.<string>} plugins List of names of plugins to uninstall.
 * @param {boolean} reload Whether to reload all renderers after updating the plugins.
 * @returns {Promise.<boolean>} Whether uninstalling the plugins was successful.
 * @alias plugins.uninstall
 */
export function uninstall(plugins, reload = true) {
  return window.pluggableElectronIpc.uninstall(plugins, reload)
}

/**
 * Fetch a list of all the active plugins.
 * @returns {Promise.<Array.<Plugin>>} List of plugins as defined by the main process.
 * @alias plugins.getActive
 */
export async function getActive() {
  const plgList = await window.pluggableElectronIpc.getActive()
  return plgList.map(plugin => new Plugin(plugin.name, plugin.url, plugin.activationPoints, plugin.active))
}

/**
 * Register all the active plugins.
 * @returns {Promise.<Array.<Plugin>>} List of plugins as defined by the main process.
 * @alias plugins.registerActive
 */
export async function registerActive() {
  const plgList = await window.pluggableElectronIpc.getActive()
  plgList.forEach(plugin => register(new Plugin(plugin.name, plugin.url, plugin.activationPoints, plugin.active)))
}

/**
 * Update provided plugins to its latest version.
 * @param {Array.<string>} plugins List of plugins to update by name.
 * @param {boolean} reload Whether to reload all renderers after updating the plugins.
 * @returns {Promise.<Array.<Plugin>>} Updated plugin as defined by the main process.
 * @alias plugins.update
 */
export async function update(plugins, reload = true) {
  const plgList = await window.pluggableElectronIpc.update(plugins, reload)
  return plgList.map(plugin => new Plugin(plugin.name, plugin.url, plugin.activationPoints, plugin.active))
}

/**
 * Check if an update is available for provided plugins.
 * @param {Array.<string>} plugin List of plugin names to check for available updates.
 * @returns {Object.<string | false>} Object with plugins as keys and new version if update is available or false as values.
 * @alias plugins.updatesAvailable
 */
export function updatesAvailable(plugin) {
  return window.pluggableElectronIpc.updatesAvailable(plugin)
}

/**
 * Toggle a plugin's active state. This determines if a plugin should be loaded in initialisation.
 * @param {String} plugin Plugin to toggle.
 * @param {boolean} active Whether plugin should be activated (true) or deactivated (false).
 * @returns {Promise.<Plugin>} Updated plugin as defined by the main process.
 * @alias plugins.toggleActive
 */
export async function toggleActive(plugin, active) {
  const plg = await window.pluggableElectronIpc.toggleActive(plugin, active)
  return new Plugin(plg.name, plg.url, plg.activationPoints, plg.active)
}
