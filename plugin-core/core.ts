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
  plugin: any,
  method: any,
  ...args: any[]
) => Promise<any> =
  window.coreAPI?.invokePluginFunc ?? window.electronAPI?.invokePluginFunc;

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
