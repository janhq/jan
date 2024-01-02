/**
 * Manages imported modules.
 */
export class ModuleManager {
  public requiredModules: Record<string, any> = {}
  public cleaningResource = false

  public static instance: ModuleManager = new ModuleManager()

  constructor() {
    if (ModuleManager.instance) {
      return ModuleManager.instance
    }
  }

  /**
   * Sets a module.
   * @param {string} moduleName - The name of the module.
   * @param {any | undefined} nodule - The module to set, or undefined to clear the module.
   */
  setModule(moduleName: string, nodule: any | undefined) {
    this.requiredModules[moduleName] = nodule
  }

  /**
   * Clears all imported modules.
   */
  clearImportedModules() {
    this.requiredModules = {}
  }
}
