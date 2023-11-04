import {
  get as getEPs,
  register,
  execute,
  executeSerial,
} from './extension-manager'
/**
 * Used to import a plugin entry point.
 * Ensure your bundler does no try to resolve this import as the plugins are not known at build time.
 * @callback importer
 * @param {string} entryPoint File to be imported.
 * @returns {module} The module containing the entry point function.
 */

/**
 * @private
 * @type {importer}
 */
export let importer: any

/**
 * @private
 * Set the plugin importer function.
 * @param {importer} callback Callback to import plugins.
 */
export function setImporter(callback: any) {
  importer = callback
}

/**
 * @private
 * @type {Boolean|null}
 */
export let presetEPs: boolean | null

/**
 * @private
 * Define how extension points are accessed.
 * @param {Boolean|null} peps Whether extension points are predefined.
 */
export function definePresetEps(peps: boolean | null) {
  presetEPs = peps === null || peps === true ? peps : false
}

/**
 * @private
 * Call exported function on imported module.
 * @param {string} url @see Activation
 * @param {string} exp Export to call
 * @param {string} [plugin] @see Activation
 */
export async function callExport(url: string, exp: string, plugin: string) {
  if (!importer) throw new Error('Importer callback has not been set')
  const main = await importer(url)
  if (!main || typeof main[exp] !== 'function') {
    console.debug(
      `Activation point "${exp}" was triggered but does not exist on ${
        plugin ? 'plugin ' + plugin : 'unknown plugin'
      }`
    )
    return
  }
  const activate = main[exp]
  switch (presetEPs) {
    case true:
      activate(getEPs())
      break

    case null:
      activate()
      break

    default:
      activate({ register, execute, executeSerial })
      break
  }
}
