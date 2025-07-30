import { SystemInformation } from '../types'

/**
 * Gets Jan's data folder path.
 *
 * @returns {Promise<string>} A Promise that resolves with Jan's data folder path.
 */
const getJanDataFolderPath = (): Promise<string> => globalThis.core.api?.getJanDataFolderPath()

/**
 * Opens the file explorer at a specific path.
 * @param {string} path - The path to open in the file explorer.
 * @returns {Promise<any>} A promise that resolves when the file explorer is opened.
 */
const openFileExplorer: (path: string) => Promise<any> = (path) =>
  globalThis.core.api?.openFileExplorer({ path })

/**
 * Joins multiple paths together.
 * @param paths - The paths to join.
 * @returns {Promise<string>} A promise that resolves with the joined path.
 */
const joinPath: (args: string[]) => Promise<string> = (args) =>
  globalThis.core.api?.joinPath({ args })

/**
 * Get dirname of a file path.
 * @param path - The file path to retrieve dirname.
 * @returns {Promise<string>} A promise that resolves the dirname.
 */
const dirName: (path: string) => Promise<string> = (path) => globalThis.core.api?.dirName(path)

/**
 * Retrieve the basename from an url.
 * @param path - The path to retrieve.
 * @returns {Promise<string>} A promise that resolves with the basename.
 */
const baseName: (paths: string) => Promise<string> = (path) => globalThis.core.api?.baseName(path)

/**
 * Opens an external URL in the default web browser.
 *
 * @param {string} url - The URL to open.
 * @returns {Promise<any>} - A promise that resolves when the URL has been successfully opened.
 */
const openExternalUrl: (url: string) => Promise<any> = (url) =>
  globalThis.core.api?.openExternalUrl(url)

/**
 * Gets the resource path of the application.
 *
 * @returns {Promise<string>} - A promise that resolves with the resource path.
 */
const getResourcePath: () => Promise<string> = () => globalThis.core.api?.getResourcePath()

/**
 * Gets the user's home path.
 * @returns return user's home path
 */
const getUserHomePath = (): Promise<string> => globalThis.core.api?.getUserHomePath()

/**
 * Log to file from browser processes.
 *
 * @param message - Message to log.
 */
const log: (message: string, fileName?: string) => void = (message, fileName) =>
  globalThis.core.api?.log(message, fileName)

/**
 * Check whether the path is a subdirectory of another path.
 *
 * @param from - The path to check.
 * @param to - The path to check against.
 *
 * @returns {Promise<boolean>} - A promise that resolves with a boolean indicating whether the path is a subdirectory.
 */
const isSubdirectory: (from: string, to: string) => Promise<boolean> = (from: string, to: string) =>
  globalThis.core.api?.isSubdirectory(from, to)

/**
 * Show toast message from browser processes.
 * @param title
 * @param message
 * @returns
 */
const showToast: (title: string, message: string) => void = (title, message) =>
  globalThis.core.api?.showToast(title, message)

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
  getJanDataFolderPath,
  openFileExplorer,
  getResourcePath,
  joinPath,
  openExternalUrl,
  baseName,
  log,
  isSubdirectory,
  getUserHomePath,
  showToast,
  dirName,
}
