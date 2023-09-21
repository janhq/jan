import { callExport } from "./import-manager"

/**
 * A slimmed down representation of a plugin for the renderer.
 */
class Plugin {
  /** @type {string} Name of the package. */
  name

  /** @type {string}  The electron url where this plugin is located. */
  url

  /** @type {Array<string>} List of activation points. */
  activationPoints

  /** @type {boolean} Whether this plugin should be activated when its activation points are triggered. */
  active

  constructor(name, url, activationPoints, active) {
    this.name = name
    this.url = url
    this.activationPoints = activationPoints
    this.active = active
  }

  /**
   * Trigger an exported callback on the plugin's main file.
   * @param {string} exp exported callback to trigger.
   */
  triggerExport(exp) {
    callExport(this.url, exp, this.name)
  }
}

export default Plugin