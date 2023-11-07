/**
 * A slimmed down representation of a plugin for the renderer.
 */
class Plugin {
  /** @type {string} Name of the package. */
  name

  /** @type {string}  The electron url where this plugin is located. */
  url

  /** @type {boolean} Whether this plugin should be activated when its activation points are triggered. */
  active

  /** @type {string} Plugin's description. */
  description

  /** @type {string} Plugin's version. */
  version

  /** @type {string} Plugin's logo. */
  icon

  constructor(
    name?: string,
    url?: string,
    active?: boolean,
    description?: string,
    version?: string,
    icon?: string
  ) {
    this.name = name
    this.url = url
    this.active = active
    this.description = description
    this.version = version
    this.icon = icon
  }
}

export default Plugin
