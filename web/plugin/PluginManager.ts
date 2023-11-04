import { JanPlugin, PluginType } from '@janhq/core'
import Plugin from './Plugin'

/**
 * Manages the registration and retrieval of plugins.
 */
export class PluginManager {
  // MARK: - Plugin Manager
  private plugins = new Map<PluginType, JanPlugin>()

  /**
   * Registers a plugin.
   * @param plugin - The plugin to register.
   */
  register<T extends JanPlugin>(plugin: T) {
    this.plugins.set(plugin.type(), plugin)
  }

  /**
   * Retrieves a plugin by its type.
   * @param type - The type of the plugin to retrieve.
   * @returns The plugin, if found.
   */
  get<T extends JanPlugin>(type: PluginType): T | undefined {
    return this.plugins.get(type) as T | undefined
  }

  /**
   * Loads all registered plugins.
   */
  load() {
    this.listPlugins().forEach((plugin) => {
      plugin.onLoad()
    })
  }

  /**
   * Unloads all registered plugins.
   */
  unload() {
    this.listPlugins().forEach((plugin) => {
      plugin.onUnload()
    })
  }

  /**
   * Retrieves a list of all registered plugins.
   * @returns An array of all registered plugins.
   */
  listPlugins() {
    return [...this.plugins.values()]
  }

  /**
   * Register a plugin with its class.
   * @param {Plugin} plugin plugin object as provided by the main process.
   * @returns {void}
   */
  async activatePlugin(plugin: Plugin) {
    if (plugin.url)
      // Import class
      await import(/* webpackIgnore: true */ plugin.url).then((pluginClass) => {
        // Register class if it has a default export
        if (
          typeof pluginClass.default === 'function' &&
          pluginClass.default.prototype
        ) {
          this.register(new pluginClass.default())
        }
      })
  }

  // MARK: - Plugin Facades
  /**
   * Registers all active plugins.
   * @returns {void}
   */
  async registerActive() {
    // Get active plugins
    const plgList = await window.pluggableElectronIpc?.getActive()
    let plugins: Plugin[] = plgList.map(
      (plugin: any) =>
        new Plugin(
          plugin.name,
          plugin.url,
          plugin.activationPoints,
          plugin.active,
          plugin.description,
          plugin.version,
          plugin.icon
        )
    )
    // Activate all
    await Promise.all(
      plugins.map((plugin: Plugin) => this.activatePlugin(plugin))
    )
  }

  /**
   * Install a new plugin.
   * @param {Array.<installOptions | string>} plugins A list of NPM specifiers, or installation configuration objects.
   * @returns {Promise.<Array.<Plugin> | false>} plugin as defined by the main process. Has property cancelled set to true if installation was cancelled in the main process.
   * @alias plugins.install
   */
  async install(plugins: any[]) {
    if (typeof window === 'undefined') {
      return
    }
    const plgList = await window.pluggableElectronIpc?.install(plugins)
    if (plgList.cancelled) return false
    return plgList.map(async (plg: any) => {
      const plugin = new Plugin(
        plg.name,
        plg.url,
        plg.activationPoints,
        plg.active
      )
      await this.activatePlugin(plugin)
      return plugin
    })
  }

  /**
   * Uninstall provided plugins
   * @param {Array.<string>} plugins List of names of plugins to uninstall.
   * @param {boolean} reload Whether to reload all renderers after updating the plugins.
   * @returns {Promise.<boolean>} Whether uninstalling the plugins was successful.
   * @alias plugins.uninstall
   */
  uninstall(plugins: string[], reload = true) {
    if (typeof window === 'undefined') {
      return
    }
    return window.pluggableElectronIpc?.uninstall(plugins, reload)
  }
}

/**
 * The singleton instance of the PluginManager.
 */
export const pluginManager = new PluginManager()
