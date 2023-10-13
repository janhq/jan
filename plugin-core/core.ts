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

/**
 * Downloads a file from a URL and saves it to the local file system.
 * @param {string} url - The URL of the file to download.
 * @param {string} fileName - The name to use for the downloaded file.
 * @returns {Promise<any>} A promise that resolves when the file is downloaded.
 */
const downloadFile: (url: string, fileName: string) => Promise<any> = (
  url,
  fileName
) =>
  window.coreAPI?.downloadFile(url, fileName) ??
  window.electronAPI?.downloadFile(url, fileName);

/**
 * Deletes a file from the local file system.
 * @param {string} path - The path of the file to delete.
 * @returns {Promise<any>} A promise that resolves when the file is deleted.
 */
const deleteFile: (path: string) => Promise<any> = (path) =>
  window.coreAPI?.deleteFile(path) ?? window.electronAPI?.deleteFile(path);

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
  downloadFile,
  deleteFile,
};
