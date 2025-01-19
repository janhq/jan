import { DownloadRequest, NetworkConfig, SystemInformation } from '../types'

/**
 * Execute a extension module function in main process
 *
 * @param     extension     extension name to import
 * @param     method     function name to execute
 * @param     args       arguments to pass to the function
 * @returns   Promise<any>
 *
 */
const executeOnMain: (
  extension: string,
  method: string,
  ...args: any[]
) => Promise<any> = (extension, method, ...args) =>
  'invokeExtensionFunc' in globalThis.core?.api
    ? globalThis.core?.api?.invokeExtensionFunc(extension, method, ...args)
    : () => {}

/**
 * Downloads a file from a URL and saves it to the local file system.
 *
 * @param {DownloadRequest} downloadRequest - The request to download the file.
 * @param {NetworkConfig} network - Optional object to specify proxy/whether to ignore SSL certificates.
 *
 * @returns {Promise<any>} A promise that resolves when the file is downloaded.
 */
const downloadFile: (
  downloadRequest: DownloadRequest,
  network?: NetworkConfig
) => Promise<any> = (downloadRequest, network) =>
  'downloadFile' in globalThis.core?.api
    ? globalThis.core?.api?.downloadFile(downloadRequest, network)
    : () => {}

/**
 * Aborts the download of a specific file.
 * @param {string} fileName - The name of the file whose download is to be aborted.
 * @returns {Promise<any>} A promise that resolves when the download has been aborted.
 */
const abortDownload: (fileName: string) => Promise<any> = (fileName) =>
  'abortDownload' in globalThis.core?.api
    ? globalThis.core?.api?.abortDownload(fileName)
    : () => {}

/**
 * Gets Jan's data folder path.
 *
 * @returns {Promise<string>} A Promise that resolves with Jan's data folder path.
 */
const getJanDataFolderPath = (): Promise<string> =>
  'getJanDataFolderPath' in globalThis.core?.api
    ? globalThis.core?.api?.getJanDataFolderPath()
    : () => {}

/**
 * Opens the file explorer at a specific path.
 * @param {string} path - The path to open in the file explorer.
 * @returns {Promise<any>} A promise that resolves when the file explorer is opened.
 */
const openFileExplorer: (path: string) => Promise<any> = (path) =>
  'openFileExplorer' in globalThis.core?.api
    ? globalThis.core.api?.openFileExplorer(path)
    : () => {}

/**
 * Joins multiple paths together.
 * @param paths - The paths to join.
 * @returns {Promise<string>} A promise that resolves with the joined path.
 */
const joinPath: (paths: string[]) => Promise<string> = (paths) =>
  'joinPath' in globalThis.core?.api
    ? globalThis.core?.api?.joinPath(paths)
    : () => {}

/**
 * Get dirname of a file path.
 * @param path - The file path to retrieve dirname.
 * @returns {Promise<string>} A promise that resolves the dirname.
 */
const dirName: (path: string) => Promise<string> = (path) =>
  'dirName' in globalThis.core?.api
    ? globalThis.core?.api?.dirName(path)
    : () => {}

/**
 * Retrieve the basename from an url.
 * @param path - The path to retrieve.
 * @returns {Promise<string>} A promise that resolves with the basename.
 */
const baseName: (paths: string) => Promise<string> = (path) =>
  'baseName' in globalThis.core?.api
    ? globalThis.core?.api?.baseName(path)
    : () => {}

/**
 * Opens an external URL in the default web browser.
 *
 * @param {string} url - The URL to open.
 * @returns {Promise<any>} - A promise that resolves when the URL has been successfully opened.
 */
const openExternalUrl: (url: string) => Promise<any> = (url) =>
  'openExternalUrl' in globalThis.core?.api
    ? globalThis.core.api?.openExternalUrl(url)
    : () => {}

/**
 * Log to file from browser processes.
 *
 * @param message - Message to log.
 */
const log: (message: string, fileName?: string) => void = (
  message,
  fileName
) =>
  'log' in globalThis.core?.api
    ? globalThis.core.api?.log(message, fileName)
    : () => {}

/**
 * Check whether the path is a subdirectory of another path.
 *
 * @param from - The path to check.
 * @param to - The path to check against.
 *
 * @returns {Promise<boolean>} - A promise that resolves with a boolean indicating whether the path is a subdirectory.
 */
const isSubdirectory: (from: string, to: string) => Promise<boolean> = (
  from: string,
  to: string
) =>
  'isSubdirectory' in globalThis.core?.api
    ? globalThis.core.api?.isSubdirectory(from, to)
    : () => {}

/**
 * Get system information
 * @returns {Promise<any>} - A promise that resolves with the system information.
 */
const systemInformation: () => Promise<SystemInformation> = () =>
  'systemInformation' in globalThis.core?.api
    ? globalThis.core.api?.systemInformation()
    : () => {}

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
  joinPath,
  openExternalUrl,
  baseName,
  log,
  isSubdirectory,
  systemInformation,
  dirName,
}
