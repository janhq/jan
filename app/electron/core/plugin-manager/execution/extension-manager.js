/**
 * This object contains a register of {@link ExtensionPoint|extension points} and the means to work with them.
 * @namespace extensionPoints
 */

import ExtensionPoint from "./ExtensionPoint.js"

/** 
 * @constant {Object.<string, ExtensionPoint>} extensionPoints
 * @private
 * Register of extension points created by the consumer
 */
const _extensionPoints = {}

/**
 * Create new extension point and add it to the registry.
 * @param {string} name Name of the extension point.
 * @returns {void}
 * @alias extensionPoints.add
 */
export function add(name) {
  _extensionPoints[name] = new ExtensionPoint(name)
}

/**
 * Remove an extension point from the registry.
 * @param {string} name Name of the extension point
 * @returns {void}
 * @alias extensionPoints.remove
 */
export function remove(name) {
  delete _extensionPoints[name]
}

/**
 * Create extension point if it does not exist and then register the given extension to it.
 * @param {string} ep Name of the extension point.
 * @param {string} extension Unique name for the extension.
 * @param {Object|Callback} response Object to be returned or function to be called by the extension point.
 * @param {number} [priority=0] Order priority for execution used for executing in serial.
 * @returns {void}
 * @alias extensionPoints.register
 */
export function register(ep, extension, response, priority) {
  if (!_extensionPoints[ep]) add(ep)
  if (_extensionPoints[ep].register) {
    _extensionPoints[ep].register(extension, response, priority)
  }
}

/**
 * Remove extensions matching regular expression from all extension points.
 * @param {RegExp} name Matcher for the name of the extension to remove.
 * @alias extensionPoints.unregisterAll
 */
export function unregisterAll(name) {
  for (const ep in _extensionPoints) _extensionPoints[ep].unregister(name)
}

/**
 * Fetch extension point by name. or all extension points if no name is given.
 * @param {string} [ep] Extension point to return
 * @returns {Object.<ExtensionPoint> | ExtensionPoint} Found extension points
 * @alias extensionPoints.get
 */
export function get(ep) {
  return (ep ? _extensionPoints[ep] : { ..._extensionPoints })
}

/**
 * Call all the extensions registered to an extension point synchronously. See execute on {@link ExtensionPoint}.
 * Call this at the point in the base code where you want it to be extended.
 * @param {string} name Name of the extension point to call
 * @param {*} [input] Parameter to provide to the extensions if they are a function
 * @returns {Array} Result of Promise.all or Promise.allSettled depending on exitOnError
 * @alias extensionPoints.execute
 */
export function execute(name, input) {
  if (!_extensionPoints[name] || !_extensionPoints[name].execute) throw new Error(
    `The extension point "${name}" is not a valid extension point`
  )
  return _extensionPoints[name].execute(input)
}

/**
 * Calls all the extensions registered to the extension point in serial. See executeSerial on {@link ExtensionPoint}
 * Call this at the point in the base code where you want it to be extended.
 * @param {string} name Name of the extension point to call
 * @param {*} [input] Parameter to provide to the extensions if they are a function
 * @returns {Promise.<*>} Result of the last extension that was called
 * @alias extensionPoints.executeSerial
 */
export function executeSerial(name, input) {
  if (!_extensionPoints[name] || !_extensionPoints[name].executeSerial) throw new Error(
    `The extension point "${name}" is not a valid extension point`
  )
  return _extensionPoints[name].executeSerial(input)
}
