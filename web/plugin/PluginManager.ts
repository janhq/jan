import { JanPlugin, PluginType } from '@janhq/core'
import Plugin from './Plugin'

/**
 * Manages the registration and retrieval of plugins.
 */
export class PluginManager {
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
   * Registers all active plugins.
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
    // Loop over and find import url
    plugins.forEach((plugin: Plugin) => {
      if (plugin.url)
        // Import class
        import(/* webpackIgnore: true */ plugin.url).then((pluginClass) => {
          // Register class if it has a default export
          if (
            typeof pluginClass.default === 'function' &&
            pluginClass.default.prototype
          ) {
            this.register(new pluginClass.default())
          }
        })
    })
  }
}

/**
 * The singleton instance of the PluginManager.
 */
export const pluginManager = new PluginManager()
