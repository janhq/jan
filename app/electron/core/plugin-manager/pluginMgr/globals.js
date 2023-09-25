import { existsSync, mkdirSync, writeFileSync } from "fs"
import { join, resolve } from "path"

export let pluginsPath = null

/**
 * @private
 * Set path to plugins directory and create the directory if it does not exist.
 * @param {string} plgPath path to plugins directory
 */
export function setPluginsPath(plgPath) {
  // Create folder if it does not exist
  let plgDir
  try {
    plgDir = resolve(plgPath)
    if (plgDir.length < 2) throw new Error()

    if (!existsSync(plgDir)) mkdirSync(plgDir)

    const pluginsJson = join(plgDir, 'plugins.json')
    if (!existsSync(pluginsJson)) writeFileSync(pluginsJson, '{}', 'utf8')

    pluginsPath = plgDir

  } catch (error) {
    throw new Error('Invalid path provided to the plugins folder')
  }

}

/**
* @private
 * Get the path to the plugins.json file.
 * @returns location of plugins.json
 */
export function getPluginsFile() { return join(pluginsPath, 'plugins.json') }


export let confirmInstall = function () {
  return new Error(
    'The facade.confirmInstall callback needs to be set in when initializing Pluggable Electron in the main process.'
  )
}

/**
 * @private
 * Set callback to use as confirmInstall.
 * @param {confirmInstall} cb Callback
 */
export function setConfirmInstall(cb) { confirmInstall = cb }

/**
 * This function is executed when plugins are installed to verify that the user indeed wants to install the plugin.
 * @callback confirmInstall
 * @param {Array.<string>} plg The specifiers used to locate the packages (from NPM or local file)
 * @returns {Promise<boolean>} Whether to proceed with the plugin installation
 */
