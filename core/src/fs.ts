/**
 * Writes data to a file at the specified path.
 * @param {string} path - The path to the file.
 * @param {string} data - The data to write to the file.
 * @returns {Promise<any>} A Promise that resolves when the file is written successfully.
 */
const writeFile: (path: string, data: string) => Promise<any> = (path, data) =>
  window.coreAPI?.writeFile(path, data);

/**
 * Checks whether the path is a directory.
 * @param path - The path to check.
 * @returns {boolean} A boolean indicating whether the path is a directory.
 */
const isDirectory = (path: string): Promise<boolean> =>
  window.coreAPI?.isDirectory(path);

/**
 * Reads the contents of a file at the specified path.
 * @param {string} path - The path of the file to read.
 * @returns {Promise<any>} A Promise that resolves with the contents of the file.
 */
const readFile: (path: string) => Promise<any> = (path) =>
  window.coreAPI?.readFile(path);

/**
 * List the directory files
 * @param {string} path - The path of the directory to list files.
 * @returns {Promise<any>} A Promise that resolves with the contents of the directory.
 */
const listFiles: (path: string) => Promise<any> = (path) =>
  window.coreAPI?.listFiles(path);

/**
 * Creates a directory at the specified path.
 * @param {string} path - The path of the directory to create.
 * @returns {Promise<any>} A Promise that resolves when the directory is created successfully.
 */
const mkdir: (path: string) => Promise<any> = (path) =>
  window.coreAPI?.mkdir(path);

/**
 * Removes a directory at the specified path.
 * @param {string} path - The path of the directory to remove.
 * @returns {Promise<any>} A Promise that resolves when the directory is removed successfully.
 */
const rmdir: (path: string) => Promise<any> = (path) =>
  window.coreAPI?.rmdir(path);
/**
 * Deletes a file from the local file system.
 * @param {string} path - The path of the file to delete.
 * @returns {Promise<any>} A Promise that resolves when the file is deleted.
 */
const deleteFile: (path: string) => Promise<any> = (path) =>
  window.coreAPI?.deleteFile(path);

/**
 * Appends data to a file at the specified path.
 * @param path path to the file
 * @param data data to append
 */
const appendFile: (path: string, data: string) => Promise<any> = (path, data) =>
  window.coreAPI?.appendFile(path, data);

/**
 * Reads a file line by line.
 * @param {string} path - The path of the file to read.
 * @returns {Promise<any>} A promise that resolves to the lines of the file.
 */
const readLineByLine: (path: string) => Promise<any> = (path) =>
  window.coreAPI?.readLineByLine(path);

export const fs = {
  isDirectory,
  writeFile,
  readFile,
  listFiles,
  mkdir,
  rmdir,
  deleteFile,
  appendFile,
  readLineByLine,
};
