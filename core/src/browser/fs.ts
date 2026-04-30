import { FileStat } from '../types'

/**
 * Writes data to a file at the specified path.
 * @returns {Promise<any>} A Promise that resolves when the file is written successfully.
 */
const writeFileSync = (...args: any[]) => globalThis.core.api?.writeFileSync({ args })

/**
 * Writes blob data to a file at the specified path.
 * @param path - The path to file.
 * @param data - The blob data.
 * @returns
 */
const writeBlob: (path: string, data: string) => Promise<any> = (path, data) =>
  globalThis.core.api?.writeBlob(path, data)

/**
 * Reads the contents of a file at the specified path.
 * @returns {Promise<any>} A Promise that resolves with the contents of the file.
 */
const readFileSync = (...args: any[]) => globalThis.core.api?.readFileSync({ args })
/**
 * Check whether the file exists
 * @param {string} path
 * @returns {boolean} A boolean indicating whether the path is a file.
 */
const existsSync = (...args: any[]) => globalThis.core.api?.existsSync({ args })
/**
 * List the directory files
 * @returns {Promise<any>} A Promise that resolves with the contents of the directory.
 */
const readdirSync = (...args: any[]) => globalThis.core.api?.readdirSync({ args })
/**
 * Creates a directory at the specified path.
 * @returns {Promise<any>} A Promise that resolves when the directory is created successfully.
 */
const mkdir = (...args: any[]) => globalThis.core.api?.mkdir({ args })

/**
 * Removes a directory at the specified path.
 * @returns {Promise<any>} A Promise that resolves when the directory is removed successfully.
 */
const rm = (...args: any[]) => globalThis.core.api?.rm({ args })

/**
 * Moves a file from the source path to the destination path.
 * @returns {Promise<any>} A Promise that resolves when the file is moved successfully.
 */
const mv = (...args: any[]) => globalThis.core.api?.mv({ args })

/**
 * Deletes a file from the local file system.
 * @param {string} path - The path of the file to delete.
 * @returns {Promise<any>} A Promise that resolves when the file is deleted.
 */
const unlinkSync = (...args: any[]) => globalThis.core.api?.unlinkSync(...args)

/**
 * Appends data to a file at the specified path.
 */
const appendFileSync = (...args: any[]) => globalThis.core.api?.appendFileSync(...args)

/**
 * Copies a file from the source path to the destination path.
 * @param src
 * @param dest
 * @returns
 */
const copyFile: (src: string, dest: string) => Promise<void> = (src, dest) =>
  globalThis.core.api?.copyFile(src, dest)

/**
 * Lists importable `.gguf` model files under each given directory (recursive).
 * Skips files whose lowercase name contains `mmproj`.
 * When `core.api.getGgufFiles` is not provided, uses the desktop `get_gguf_files` Tauri command.
 */
const getGgufFiles: (paths: string[]) => Promise<string[]> = async (paths) => {
  if (globalThis.core.api?.getGgufFiles) {
    const result = await globalThis.core.api.getGgufFiles(paths)
    return Array.isArray(result) ? result : []
  }
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<string[]>('get_gguf_files', { paths })
}

/**
 * Gets the file's stats.
 *
 * @param path - The path to the file.
 * @param outsideJanDataFolder - Whether the file is outside the Jan data folder.
 * @returns {Promise<FileStat>} - A promise that resolves with the file's stats.
 */
const fileStat: (path: string) => Promise<FileStat | undefined> = (path) =>
  globalThis.core.api?.fileStat({ args: path })

// TODO: Export `dummy` fs functions automatically
// Currently adding these manually
export const fs = {
  writeFileSync,
  readFileSync,
  existsSync,
  readdirSync,
  mkdir,
  rm,
  mv,
  unlinkSync,
  appendFileSync,
  copyFile,
  fileStat,
  writeBlob,
  getGgufFiles,
}
