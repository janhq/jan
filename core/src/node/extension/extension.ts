import { rmdirSync } from 'fs'
import { resolve, join } from 'path'
import { ExtensionManager } from './manager'

/**
 * An NPM package that can be used as an extension.
 * Used to hold all the information and functions necessary to handle the extension lifecycle.
 */
export default class Extension {
  /**
   * @property {string} origin Original specification provided to fetch the package.
   * @property {Object} installOptions Options provided to pacote when fetching the manifest.
   * @property {name} name The name of the extension as defined in the manifest.
   * @property {string} url Electron URL where the package can be accessed.
   * @property {string} version Version of the package as defined in the manifest.
   * @property {string} main The entry point as defined in the main entry of the manifest.
   * @property {string} description The description of extension as defined in the manifest.
   */
  origin?: string
  installOptions: any
  name?: string
  url?: string
  version?: string
  main?: string
  description?: string

  /** @private */
  _active = false

  /**
   * @private
   * @property {Object.<string, Function>} #listeners A list of callbacks to be executed when the Extension is updated.
   */
  listeners: Record<string, (obj: any) => void> = {}

  /**
   * Set installOptions with defaults for options that have not been provided.
   * @param {string} [origin] Original specification provided to fetch the package.
   * @param {Object} [options] Options provided to pacote when fetching the manifest.
   */
  constructor(origin?: string, options = {}) {
    const Arborist = require('@npmcli/arborist')
    const defaultOpts = {
      version: false,
      fullMetadata: false,
      Arborist,
    }

    this.origin = origin
    this.installOptions = { ...defaultOpts, ...options }
  }

  /**
   * Package name with version number.
   * @type {string}
   */
  get specifier() {
    return this.origin + (this.installOptions.version ? '@' + this.installOptions.version : '')
  }

  /**
   * Whether the extension should be registered with its activation points.
   * @type {boolean}
   */
  get active() {
    return this._active
  }

  /**
   * Set Package details based on it's manifest
   * @returns {Promise.<Boolean>} Resolves to true when the action completed
   */
  async getManifest() {
    // Get the package's manifest (package.json object)
    try {
      await import('pacote').then((pacote) => {
        return pacote.manifest(this.specifier, this.installOptions).then((mnf) => {
          // set the Package properties based on the it's manifest
          this.name = mnf.name
          this.version = mnf.version
          this.main = mnf.main
          this.description = mnf.description
        })
      })
    } catch (error) {
      throw new Error(`Package ${this.origin} does not contain a valid manifest: ${error}`)
    }

    return true
  }

  /**
   * Extract extension to extensions folder.
   * @returns {Promise.<Extension>} This extension
   * @private
   */
  async _install() {
    try {
      // import the manifest details
      await this.getManifest()

      // Install the package in a child folder of the given folder
      const pacote = await import('pacote')
      await pacote.extract(
        this.specifier,
        join(ExtensionManager.instance.getExtensionsPath() ?? '', this.name ?? ''),
        this.installOptions
      )

      // Set the url using the custom extensions protocol
      this.url = `extension://${this.name}/${this.main}`

      this.emitUpdate()
    } catch (err) {
      // Ensure the extension is not stored and the folder is removed if the installation fails
      this.setActive(false)
      throw err
    }

    return [this]
  }

  /**
   * Subscribe to updates of this extension
   * @param {string} name name of the callback to register
   * @param {callback} cb The function to execute on update
   */
  subscribe(name: string, cb: () => void) {
    this.listeners[name] = cb
  }

  /**
   * Remove subscription
   * @param {string} name name of the callback to remove
   */
  unsubscribe(name: string) {
    delete this.listeners[name]
  }

  /**
   * Execute listeners
   */
  emitUpdate() {
    for (const cb in this.listeners) {
      this.listeners[cb].call(null, this)
    }
  }

  /**
   * Check for updates and install if available.
   * @param {string} version The version to update to.
   * @returns {boolean} Whether an update was performed.
   */
  async update(version = false) {
    if (await this.isUpdateAvailable()) {
      this.installOptions.version = version
      await this._install()
      return true
    }

    return false
  }

  /**
   * Check if a new version of the extension is available at the origin.
   * @returns the latest available version if a new version is available or false if not.
   */
  async isUpdateAvailable() {
    return import('pacote').then((pacote) => {
      if (this.origin) {
        return pacote.manifest(this.origin).then((mnf) => {
          return mnf.version !== this.version ? mnf.version : false
        })
      }
    })
  }

  /**
   * Remove extension and refresh renderers.
   * @returns {Promise}
   */
  async uninstall(): Promise<void> {
    const path = ExtensionManager.instance.getExtensionsPath()
    const extPath = resolve(path ?? '', this.name ?? '')
    await rmdirSync(extPath, { recursive: true })

    this.emitUpdate()
  }

  /**
   * Set a extension's active state. This determines if a extension should be loaded on initialisation.
   * @param {boolean} active State to set _active to
   * @returns {Extension} This extension
   */
  setActive(active: boolean) {
    this._active = active
    this.emitUpdate()
    return this
  }
}
