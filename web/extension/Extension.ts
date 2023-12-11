/**
 * Extension manifest object.
 */
class Extension {
  /** @type {string} Name of the extension. */
  name?: string

  /** @type {string} The URL of the extension to load. */
  url: string

  /** @type {boolean} Whether the extension is activated or not. */
  active

  /** @type {string} Extension's description. */
  description

  /** @type {string} Extension's version. */
  version

  constructor(
    url: string,
    name?: string,
    active?: boolean,
    description?: string,
    version?: string
  ) {
    this.name = name
    this.url = url
    this.active = active
    this.description = description
    this.version = version
  }
}

export default Extension
