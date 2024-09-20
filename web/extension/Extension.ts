/**
 * Extension manifest object.
 */
class Extension {
  /** @type {string} Name of the extension. */
  name: string

  /** @type {string} Product name of the extension. */
  productName?: string

  /** @type {string} The URL of the extension to load. */
  url: string

  /** @type {boolean} Whether the extension is activated or not. */
  active?: boolean

  /** @type {string} Extension's description. */
  description?: string

  /** @type {string} Extension's version. */
  version?: string

  constructor(
    url: string,
    name: string,
    productName?: string,
    active?: boolean,
    description?: string,
    version?: string
  ) {
    this.name = name
    this.productName = productName
    this.url = url
    this.active = active
    this.description = description
    this.version = version
  }
}

export default Extension
