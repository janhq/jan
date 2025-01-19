import { FileStat } from '../types'

/**
 * Writes data to a file at the specified path.
 * @returns {Promise<any>} A Promise that resolves when the file is written successfully.
 */
const writeFileSync = (...args: any[]) =>
  'writeFileSync' in globalThis.core?.api
    ? globalThis.core.api?.writeFileSync(...args)
    : () => {}

/**
 * Reads the contents of a file at the specified path.
 * @returns {Promise<any>} A Promise that resolves with the contents of the file.
 */
const readFileSync = (...args: any[]) =>
  'readFileSync' in globalThis.core?.api
    ? globalThis.core.api?.readFileSync(...args)
    : () => ''
/**
 * Check whether the file exists
 * @param {string} path
 * @returns {boolean} A boolean indicating whether the path is a file.
 */
const existsSync = (...args: any[]) =>
  'existsSync' in globalThis.core?.api
    ? globalThis.core.api?.existsSync(...args)
    : () => false
/**
 * List the directory files
 * @returns {Promise<any>} A Promise that resolves with the contents of the directory.
 */
const readdirSync = (...args: any[]) =>
  'readdirSync' in globalThis.core?.api
    ? globalThis.core.api?.readdirSync(...args)
    : () => []
/**
 * Creates a directory at the specified path.
 * @returns {Promise<any>} A Promise that resolves when the directory is created successfully.
 */
const mkdir = (...args: any[]) =>
  'mkdir' in globalThis.core?.api
    ? globalThis.core.api?.mkdir(...args)
    : () => {}

/**
 * Removes a directory at the specified path.
 * @returns {Promise<any>} A Promise that resolves when the directory is removed successfully.
 */
const rm = (...args: any[]) =>
  'rm' in globalThis.core?.api
    ? globalThis.core.api?.rm(...args, { recursive: true, force: true })
    : () => {}

/**
 * Deletes a file from the local file system.
 * @param {string} path - The path of the file to delete.
 * @returns {Promise<any>} A Promise that resolves when the file is deleted.
 */
const unlinkSync = (...args: any[]) =>
  'unlinkSync' in globalThis.core?.api
    ? globalThis.core.api?.unlinkSync(...args)
    : () => {}

/**
 * Gets the list of gguf files in a directory
 *
 * @param path - The paths to the file.
 * @returns {Promise<{any}>} - A promise that resolves with the list of gguf and non-gguf files
 */
const getGgufFiles: (paths: string[]) => Promise<any> = (paths) =>
  'getGgufFiles' in globalThis.core?.api
    ? globalThis.core.api?.getGgufFiles(paths)
    : () => []

/**
 * Gets the file's stats.
 *
 * @param path - The path to the file.
 * @param outsideJanDataFolder - Whether the file is outside the Jan data folder.
 * @returns {Promise<FileStat>} - A promise that resolves with the file's stats.
 */
const fileStat: (
  path: string,
  outsideJanDataFolder?: boolean
) => Promise<FileStat | undefined> = (path, outsideJanDataFolder) =>
  'fileStat' in globalThis.core?.api
    ? globalThis.core.api?.fileStat(path, outsideJanDataFolder)
    : () => undefined

// TODO: Export `dummy` fs functions automatically
// Currently adding these manually
export const fs = {
  writeFileSync,
  readFileSync,
  existsSync,
  readdirSync,
  mkdir,
  rm,
  unlinkSync,
  fileStat,
  getGgufFiles,
}
