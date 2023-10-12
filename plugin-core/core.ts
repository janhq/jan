/**
 * Execute a plugin module function in main process
 *
 * @param     plugin     plugin name to import
 * @param     method     function name to execute
 * @param     args       arguments to pass to the function
 * @returns   Promise<any>
 *
 */
const invokePluginFunc: (
  plugin: string,
  method: string,
  ...args: any[]
) => Promise<any> = (plugin, method, ...args) =>
  window.coreAPI?.invokePluginFunc(plugin, method, ...args) ??
  window.electronAPI?.invokePluginFunc(plugin, method, ...args);

/** Register extension point function type definition
 *
 */
export type RegisterExtensionPoint = (
  extensionName: string,
  extensionId: string,
  method: Function,
  priority?: number
) => void;
/**
 * Core exports
 */
export const core = {
  invokePluginFunc,
};
