/* eslint-disable @typescript-eslint/no-explicit-any */

import { BaseExtension, ExtensionTypeEnum } from '@janhq/core'

import Extension from './Extension'

/**
 * Manages the registration and retrieval of extensions.
 */
export class ExtensionManager {
  private extensions = new Map<string, BaseExtension>()

  /**
   * Registers an extension.
   * @param extension - The extension to register.
   */
  register<T extends BaseExtension>(name: string, extension: T) {
    this.extensions.set(extension.type() ?? name, extension)
  }

  /**
   * Retrieves a extension by its type.
   * @param type - The type of the extension to retrieve.
   * @returns The extension, if found.
   */
  get<T extends BaseExtension>(type: ExtensionTypeEnum): T | undefined {
    return this.extensions.get(type) as T | undefined
  }

  /**
   * Loads all registered extension.
   */
  load() {
    this.listExtensions().forEach((ext) => {
      ext.onLoad()
    })
  }

  /**
   * Unloads all registered extensions.
   */
  unload() {
    this.listExtensions().forEach((ext) => {
      ext.onUnload()
    })
  }

  /**
   * Retrieves a list of all registered extensions.
   * @returns An array of extensions.
   */
  listExtensions() {
    return [...this.extensions.values()]
  }

  /**
   * Retrieves a list of all registered extensions.
   * @returns An array of extensions.
   */
  async getActive(): Promise<Extension[]> {
    const res = await window.core?.api?.getActiveExtensions()
    if (!res || !Array.isArray(res)) return []

    const extensions: Extension[] = res.map(
      (ext: any) =>
        new Extension(
          ext.url,
          ext.name,
          ext.active,
          ext.description,
          ext.version
        )
    )
    return extensions
  }

  /**
   * Register a extension with its class.
   * @param {Extension} extension extension object as provided by the main process.
   * @returns {void}
   */
  async activateExtension(extension: Extension) {
    // Import class
    const extensionUrl = window.electronAPI
      ? extension.url
      : extension.url.replace(
          'extension://',
          `${window.core?.api?.baseApiUrl ?? ''}/extensions/`
        )
    await import(/* webpackIgnore: true */ extensionUrl).then(
      (extensionClass) => {
        // Register class if it has a default export
        if (
          typeof extensionClass.default === 'function' &&
          extensionClass.default.prototype
        ) {
          this.register(
            extension.name ?? extension.url,
            new extensionClass.default()
          )
        }
      }
    )
  }

  /**
   * Registers all active extensions.
   * @returns {void}
   */
  async registerActive() {
    // Get active extensions
    const activeExtensions = await this.getActive()
    // Activate all
    await Promise.all(
      activeExtensions.map((ext: Extension) => this.activateExtension(ext))
    )
  }

  /**
   * Install a new extension.
   * @param {Array.<installOptions | string>} extensions A list of NPM specifiers, or installation configuration objects.
   * @returns {Promise.<Array.<Extension> | false>} extension as defined by the main process. Has property cancelled set to true if installation was cancelled in the main process.
   */
  async install(extensions: any[]) {
    if (typeof window === 'undefined') {
      return
    }
    const res = await window.core?.api?.installExtension(extensions)
    if (res.cancelled) return false
    return res.map(async (ext: any) => {
      const extension = new Extension(ext.name, ext.url, ext.active)
      await this.activateExtension(extension)
      return extension
    })
  }

  /**
   * Uninstall provided extensions
   * @param {Array.<string>} extensions List of names of extensions to uninstall.
   * @param {boolean} reload Whether to reload all renderers after updating the extensions.
   * @returns {Promise.<boolean>} Whether uninstalling the extensions was successful.
   */
  uninstall(extensions: string[], reload = true) {
    if (typeof window === 'undefined') {
      return
    }
    return window.core?.api?.uninstallExtension(extensions, reload)
  }
}

/**
 * The singleton instance of the ExtensionManager.
 */
export const extensionManager = new ExtensionManager()
