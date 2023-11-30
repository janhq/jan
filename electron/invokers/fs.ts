import { shell } from 'electron'

const { ipcRenderer } = require('electron')

export function fsInvokers() {
  const interfaces = {
    /**
     * Deletes a file at the specified path.
     * @param {string} filePath - The path of the file to delete.
     */
    deleteFile: (filePath: string) =>
      ipcRenderer.invoke('deleteFile', filePath),

    /**
     * Checks if the path points to a directory.
     * @param {string} filePath - The path to check.
     */
    isDirectory: (filePath: string) =>
      ipcRenderer.invoke('isDirectory', filePath),

    /**
     * Retrieves the user's space.
     */
    getUserSpace: () => ipcRenderer.invoke('getUserSpace'),

    /**
     * Reads a file at the specified path.
     * @param {string} path - The path of the file to read.
     */
    readFile: (path: string) => ipcRenderer.invoke('readFile', path),

    /**
     * Writes data to a file at the specified path.
     * @param {string} path - The path of the file to write to.
     * @param {string} data - The data to write.
     */
    writeFile: (path: string, data: string) =>
      ipcRenderer.invoke('writeFile', path, data),

    /**
     * Lists the files in a directory at the specified path.
     * @param {string} path - The path of the directory to list files from.
     */
    listFiles: (path: string) => ipcRenderer.invoke('listFiles', path),

    /**
     * Appends data to a file at the specified path.
     * @param {string} path - The path of the file to append to.
     * @param {string} data - The data to append.
     */
    appendFile: (path: string, data: string) =>
      ipcRenderer.invoke('appendFile', path, data),

    /**
     * Reads a file line by line at the specified path.
     * @param {string} path - The path of the file to read.
     */
    readLineByLine: (path: string) =>
      ipcRenderer.invoke('readLineByLine', path),

    /**
     * Creates a directory at the specified path.
     * @param {string} path - The path where the directory should be created.
     */
    mkdir: (path: string) => ipcRenderer.invoke('mkdir', path),

    /**
     * Removes a directory at the specified path.
     * @param {string} path - The path of the directory to remove.
     */
    rmdir: (path: string) => ipcRenderer.invoke('rmdir', path),
  }

  return interfaces
}
