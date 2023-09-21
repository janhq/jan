import { callExport } from "./import-manager.js"

class Activation {
  /** @type {string} Name of the registered plugin. */
  plugin

  /** @type {string} Name of the activation point that is registered to. */
  activationPoint

  /** @type {string} location of the file containing the activation function. */
  url

  /** @type {boolean} Whether the activation has been activated. */
  activated

  constructor(plugin, activationPoint, url) {
    this.plugin = plugin
    this.activationPoint = activationPoint
    this.url = url
    this.activated = false
  }

  /**
   * Trigger the activation function in the plugin once,
   * providing the list of extension points or an object with the extension point's register, execute and executeSerial functions.
   * @returns {boolean} Whether the activation has already been activated.
   */
  async trigger() {
    if (!this.activated) {
      await callExport(this.url, this.activationPoint, this.plugin)
      this.activated = true
    }
    return this.activated
  }
}

export default Activation
