import { FileStat } from './types'

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
 * @param {object} network - Optional object to specify proxy/whether to ignore SSL certificates.
 * @returns {Promise<any>} A promise that resolves when the file is downloaded.
 */
const downloadFile: (
  url: string,
  fileName: string,
  network?: { proxy?: string; ignoreSSL?: boolean }
) => Promise<any> = (url, fileName, network) => {
  return global.core?.api?.downloadFile(url, fileName, network)
}

/**
 * Aborts the download of a specific file.
 * @param {string} fileName - The name of the file whose download is to be aborted.
 * @returns {Promise<any>} A promise that resolves when the download has been aborted.
 */
const abortDownload: (fileName: string) => Promise<any> = (fileName) =>
  global.core.api?.abortDownload(fileName)

/**
 * Gets Jan's data folder path.
 *
 * @returns {Promise<string>} A Promise that resolves with Jan's data folder path.
 */
const getJanDataFolderPath = (): Promise<string> => global.core.api?.getJanDataFolderPath()

/**
 * Opens the file explorer at a specific path.
 * @param {string} path - The path to open in the file explorer.
 * @returns {Promise<any>} A promise that resolves when the file explorer is opened.
 */
const openFileExplorer: (path: string) => Promise<any> = (path) =>
  global.core.api?.openFileExplorer(path)

/**
 * Joins multiple paths together.
 * @param paths - The paths to join.
 * @returns {Promise<string>} A promise that resolves with the joined path.
 */
const joinPath: (paths: string[]) => Promise<string> = (paths) => global.core.api?.joinPath(paths)

/**
 * Retrive the basename from an url.
 * @param path - The path to retrieve.
 * @returns {Promise<string>} A promise that resolves with the basename.
 */
const baseName: (paths: string) => Promise<string> = (path) => global.core.api?.baseName(path)

/**
 * Opens an external URL in the default web browser.
 *
 * @param {string} url - The URL to open.
 * @returns {Promise<any>} - A promise that resolves when the URL has been successfully opened.
 */
const openExternalUrl: (url: string) => Promise<any> = (url) =>
  global.core.api?.openExternalUrl(url)

/**
 * Gets the resource path of the application.
 *
 * @returns {Promise<string>} - A promise that resolves with the resource path.
 */
const getResourcePath: () => Promise<string> = () => global.core.api?.getResourcePath()

/**
 * Gets the user's home path.
 * @returns return user's home path
 */
const getUserHomePath = (): Promise<string> => global.core.api?.getUserHomePath()

/**
 * Log to file from browser processes.
 *
 * @param message - Message to log.
 */
const log: (message: string, fileName?: string) => void = (message, fileName) =>
  global.core.api?.log(message, fileName)

/**
 * Check whether the path is a subdirectory of another path.
 *
 * @param from - The path to check.
 * @param to - The path to check against.
 *
 * @returns {Promise<boolean>} - A promise that resolves with a boolean indicating whether the path is a subdirectory.
 */
const isSubdirectory: (from: string, to: string) => Promise<boolean> = (from: string, to: string) =>
  global.core.api?.isSubdirectory(from, to)

/**
 * Register extension point function type definition
 */
export type RegisterExtensionPoint = (
  extensionName: string,
  extensionId: string,
  method: Function,
  priority?: number
) => void

/**
 * Functions exports
 */
export {
  executeOnMain,
  downloadFile,
  abortDownload,
  getJanDataFolderPath,
  openFileExplorer,
  getResourcePath,
  joinPath,
  openExternalUrl,
  baseName,
  log,
  isSubdirectory,
  getUserHomePath,
  FileStat,
}
