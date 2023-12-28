/**
 * Execute a extension module function in main process
 *
 * @param     extension     extension name to import
 * @param     method     function name to execute
 * @param     args       arguments to pass to the function
 * @returns   Promise<any>
 *
 */
const executeOnMain: (extension: string, method: string, ...args: any[]) => Promise<any> = (
  extension,
  method,
  ...args
) => global.core?.api?.invokeExtensionFunc(extension, method, ...args)

/**
 * Downloads a file from a URL and saves it to the local file system.
 * @param {string} url - The URL of the file to download.
 * @param {string} fileName - The name to use for the downloaded file.
 * @returns {Promise<any>} A promise that resolves when the file is downloaded.
 */
const downloadFile: (url: string, fileName: string) => Promise<any> = (url, fileName) =>
  global.core?.api?.downloadFile(url, fileName)

/**
 * Aborts the download of a specific file.
 * @param {string} fileName - The name of the file whose download is to be aborted.
 * @returns {Promise<any>} A promise that resolves when the download has been aborted.
 */
const abortDownload: (fileName: string) => Promise<any> = (fileName) =>
  global.core.api?.abortDownload(fileName)

/**
 * Gets the user space path.
 * @returns {Promise<any>} A Promise that resolves with the user space path.
 */
const getUserSpace = (): Promise<string> => global.core.api?.getUserSpace()

/**
 * Opens the file explorer at a specific path.
 * @param {string} path - The path to open in the file explorer.
 * @returns {Promise<any>} A promise that resolves when the file explorer is opened.
 */
const openFileExplorer: (path: string) => Promise<any> = (path) =>
  global.core.api?.openFileExplorer(path)

const janJoin: (dirs: string[]) => Promise<string> = (dirs) => global.core.api?.janJoin(dirs)

const getResourcePath: () => Promise<string> = () => global.core.api?.getResourcePath()

/**
 * Register extension point function type definition
 */
export type RegisterExtensionPoint = (
  extensionName: string,
  extensionId: string,
  method: Function,
  priority?: number,
) => void

/**
 * Functions exports
 */
export {
  executeOnMain,
  downloadFile,
  abortDownload,
  getUserSpace,
  openFileExplorer,
  getResourcePath,
  janJoin,
}
