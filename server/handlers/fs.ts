import { app, ipcMain } from 'electron'
import * as fs from 'fs'
import { join } from 'path'

/**
 * Handles file system operations.
 */
export function handleFsIPCs() {
  const userSpacePath = join(app.getPath('home'), 'jan')

  /**
   * Gets the path to the user data directory.
   * @param event - The event object.
   * @returns A promise that resolves with the path to the user data directory.
   */
  ipcMain.handle(
    'getUserSpace',
    (): Promise<string> => Promise.resolve(userSpacePath)
  )

  /**
   * Checks whether the path is a directory.
   * @param event - The event object.
   * @param path - The path to check.
   * @returns A promise that resolves with a boolean indicating whether the path is a directory.
   */
  ipcMain.handle('isDirectory', (_event, path: string): Promise<boolean> => {
    const fullPath = join(userSpacePath, path)
    return Promise.resolve(
      fs.existsSync(fullPath) && fs.lstatSync(fullPath).isDirectory()
    )
  })

  /**
   * Reads a file from the user data directory.
   * @param event - The event object.
   * @param path - The path of the file to read.
   * @returns A promise that resolves with the contents of the file.
   */
  ipcMain.handle('readFile', async (event, path: string): Promise<string> => {
    return new Promise((resolve, reject) => {
      fs.readFile(join(userSpacePath, path), 'utf8', (err, data) => {
        if (err) {
          reject(err)
        } else {
          resolve(data)
        }
      })
    })
  })

  /**
   * Writes data to a file in the user data directory.
   * @param event - The event object.
   * @param path - The path of the file to write to.
   * @param data - The data to write to the file.
   * @returns A promise that resolves when the file has been written.
   */
  ipcMain.handle(
    'writeFile',
    async (event, path: string, data: string): Promise<void> => {
      return new Promise((resolve, reject) => {
        fs.writeFile(join(userSpacePath, path), data, 'utf8', (err) => {
          if (err) {
            reject(err)
          } else {
            resolve()
          }
        })
      })
    }
  )

  /**
   * Creates a directory in the user data directory.
   * @param event - The event object.
   * @param path - The path of the directory to create.
   * @returns A promise that resolves when the directory has been created.
   */
  ipcMain.handle('mkdir', async (event, path: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      fs.mkdir(join(userSpacePath, path), { recursive: true }, (err) => {
        if (err) {
          reject(err)
        } else {
          resolve()
        }
      })
    })
  })

  /**
   * Removes a directory in the user data directory.
   * @param event - The event object.
   * @param path - The path of the directory to remove.
   * @returns A promise that resolves when the directory is removed successfully.
   */
  ipcMain.handle('rmdir', async (event, path: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      fs.rmdir(join(userSpacePath, path), { recursive: true }, (err) => {
        if (err) {
          reject(err)
        } else {
          resolve()
        }
      })
    })
  })

  /**
   * Lists the files in a directory in the user data directory.
   * @param event - The event object.
   * @param path - The path of the directory to list files from.
   * @returns A promise that resolves with an array of file names.
   */
  ipcMain.handle(
    'listFiles',
    async (event, path: string): Promise<string[]> => {
      return new Promise((resolve, reject) => {
        fs.readdir(join(userSpacePath, path), (err, files) => {
          if (err) {
            reject(err)
          } else {
            resolve(files)
          }
        })
      })
    }
  )

  /**
   * Deletes a file from the user data folder.
   * @param _event - The IPC event object.
   * @param filePath - The path to the file to delete.
   * @returns A string indicating the result of the operation.
   */
  ipcMain.handle('deleteFile', async (_event, filePath) => {
    const fullPath = join(userSpacePath, filePath)

    let result = 'NULL'
    fs.unlink(fullPath, function (err) {
      if (err && err.code == 'ENOENT') {
        result = `File not exist: ${err}`
      } else if (err) {
        result = `File delete error: ${err}`
      } else {
        result = 'File deleted successfully'
      }
      console.debug(
        `Delete file ${filePath} from ${fullPath} result: ${result}`
      )
    })

    return result
  })
}
