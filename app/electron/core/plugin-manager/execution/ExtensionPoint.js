/**
 * @typedef {Object} Extension An extension registered to an extension point
 * @property {string} name Unique name for the extension.
 * @property {Object|Callback} response Object to be returned or function to be called by the extension point.
 * @property {number} [priority] Order priority for execution used for executing in serial.
 */

/**
 * Represents a point in the consumer's code that can be extended by a plugin.
 * The plugin can register a callback or object to the extension point.
 * When the extension point is triggered, the provided function will then be called or object will be returned.
 */
class ExtensionPoint {
  /** @type {string} Name of the extension point */
  name

  /**
   * @type {Array.<Extension>} The list of all extensions registered with this extension point.
   * @private
   */
  _extensions = []

  /**
   * @type {Array.<Object>} A list of functions to be executed when the list of extensions changes.
   * @private
   */
  #changeListeners = []

  constructor(name) {
    this.name = name
  }

  /**
   * Register new extension with this extension point.
   * The registered response will be executed (if callback) or returned (if object) 
   * when the extension point is executed (see below).
   * @param {string} name Unique name for the extension.
   * @param {Object|Callback} response Object to be returned or function to be called by the extension point.
   * @param {number} [priority] Order priority for execution used for executing in serial.
   * @returns {void}
   */
  register(name, response, priority = 0) {
    const index = this._extensions.findIndex(p => p.priority > priority)
    const newExt = { name, response, priority }
    if (index > -1) {
      this._extensions.splice(index, 0, newExt)
    } else {
      this._extensions.push(newExt)
    }

    this.#emitChange()
  }

  /**
   * Remove an extension from the registry. It will no longer be part of the extension point execution.
   * @param {RegExp } name Matcher for the name of the extension to remove.
   * @returns {void}
   */
  unregister(name) {
    const index = this._extensions.findIndex(ext => ext.name.match(name))
    if (index > -1) this._extensions.splice(index, 1)

    this.#emitChange()
  }

  /**
   * Empty the registry of all extensions.
   * @returns {void}
   */
  clear() {
    this._extensions = []
    this.#emitChange()
  }

  /**
   * Get a specific extension registered with the extension point
   * @param {string} name Name of the extension to return
   * @returns {Object|Callback|undefined} The response of the extension. If this is a function the function is returned, not its response.
   */
  get(name) {
    const ep = this._extensions.find(ext => ext.name === name)
    return ep && ep.response
  }

  /**
   * Execute (if callback) and return or just return (if object) the response for each extension registered to this extension point.
   * Any asynchronous responses will be executed in parallel and the returned array will contain a promise for each of these responses.
   * @param {*} input Input to be provided as a parameter to each response if response is a callback.
   * @returns {Array} List of responses from the extensions.
   */
  execute(input) {
    return this._extensions.map(p => {
      if (typeof p.response === 'function') {
        return p.response(input)
      } else {
        return p.response
      }
    })
  }

  /**
   * Execute (if callback) and return the response, or push it to the array if the previous response is an array
   * for each extension registered to this extension point in serial,
   * feeding the result from the last response as input to the next.
   * @param {*} input Input to be provided as a parameter to the 1st callback
   * @returns {Promise.<*>} Result of the last extension that was called
   */
  async executeSerial(input) {
    return await this._extensions.reduce(async (throughput, p) => {
      let tp = await throughput
      if (typeof p.response === 'function') {
        tp = await p.response(tp)
      } else if (Array.isArray(tp)) {
        tp.push(p.response)
      }
      return tp
    }, input)
  }

  /**
   * Register a callback to be executed if the list of extensions changes.
   * @param {string} name Name of the listener needed if it is to be removed.
   * @param {Function} callback The callback function to trigger on a change.
   */
  onRegister(name, callback) {
    if (typeof callback === 'function') this.#changeListeners.push({ name, callback })
  }

  /**
   * Unregister a callback from the extension list changes.
   * @param {string} name The name of the listener to remove.
   */
  offRegister(name) {
    const index = this.#changeListeners.findIndex(l => l.name === name)
    if (index > -1) this.#changeListeners.splice(index, 1)
  }

  #emitChange() {
    for (const l of this.#changeListeners) {
      l.callback(this)
    }
  }
}

export default ExtensionPoint