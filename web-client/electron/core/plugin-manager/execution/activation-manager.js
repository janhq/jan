import Activation from "./Activation.js"

/**
 * This object contains a register of plugin registrations to an activation points, and the means to work with them.
 * @namespace activationPoints
 */

/** 
 * @constant {Array.<Activation>} activationRegister
 * @private
 * Store of activations used by the consumer
 */
const activationRegister = []

/**
 * Register a plugin with its activation points (as defined in its manifest).
 * @param {Plugin} plugin plugin object as provided by the main process.
 * @returns {void}
 * @alias activationPoints.register
 */
export function register(plugin) {
  if (!Array.isArray(plugin.activationPoints)) throw new Error(
    `Plugin ${plugin.name || 'without name'} does not have any activation points set up in its manifest.`
  )
  for (const ap of plugin.activationPoints) {
    // Ensure plugin is not already registered to activation point
    const duplicate = activationRegister.findIndex(act =>
      act.plugin === plugin.name && act.activationPoint === ap
    )

    // Create new activation and add it to the register
    if (duplicate < 0) activationRegister.push(new Activation(plugin.name, ap, plugin.url))
  }
}

/**
 * Trigger all activations registered to the given activation point. See {@link Plugin}.
 * This will call the function with the same name as the activation point on the path specified in the plugin.
 * @param {string} activationPoint Name of the activation to trigger
 * @returns {Promise.<Boolean>} Resolves to true when the activations are complete. 
 * @alias activationPoints.trigger
 */
export async function trigger(activationPoint) {
  // Make sure all triggers are complete before returning
  await Promise.all(
    // Trigger each relevant activation point from the register and return an array of trigger promises
    activationRegister.reduce((triggered, act) => {
      if (act.activationPoint === activationPoint) {
        triggered.push(act.trigger())
      }
      return triggered
    }, [])
  )
  return true
}

/**
 * Remove a plugin from the activations register.
 * @param {string} plugin Name of the plugin to remove.
 * @returns {void}
 * @alias activationPoints.remove
 */
export function remove(plugin) {
  let i = activationRegister.length
  while (i--) {
    if (activationRegister[i].plugin === plugin) {
      activationRegister.splice(i, 1)
    }
  }
}

/**
 * Remove all activations from the activation register.
 * @returns {void}
 * @alias activationPoints.clear
 */
export function clear() {
  activationRegister.length = 0
}

/**
 * Fetch all activations.
 * @returns {Array.<Activation>} Found extension points
 * @alias activationPoints.get
 */
export function get() {
  return [...activationRegister]
}