import { app, ipcMain } from 'electron'
import * as fs from 'fs'
import { join } from 'path'
import readline from 'readline'
import { userSpacePath } from '../utils/path'

/**
 * Handles file system operations.
 */
export function handleFsIPCs() {
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
      try {
        await fs.writeFileSync(join(userSpacePath, path), data, 'utf8')
      } catch (err) {
        console.error(`writeFile ${path} result: ${err}`)
      }
    }
  )

  /**
   * Creates a directory in the user data directory.
   * @param event - The event object.
   * @param path - The path of the directory to create.
   * @returns A promise that resolves when the directory has been created.
   */
  ipcMain.handle('mkdir', async (event, path: string): Promise<void> => {
    try {
      fs.mkdirSync(join(userSpacePath, path), { recursive: true })
    } catch (err) {
      console.error(`mkdir ${path} result: ${err}`)
    }
  })

  /**
   * Removes a directory in the user data directory.
   * @param event - The event object.
   * @param path - The path of the directory to remove.
   * @returns A promise that resolves when the directory is removed successfully.
   */
  ipcMain.handle('rmdir', async (event, path: string): Promise<void> => {
    try {
      await fs.rmSync(join(userSpacePath, path), { recursive: true })
    } catch (err) {
      console.error(`rmdir ${path} result: ${err}`)
    }
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
    try {
      await fs.unlinkSync(join(userSpacePath, filePath))
    } catch (err) {
      console.error(`unlink ${filePath} result: ${err}`)
    }
  })

  /**
   * Appends data to a file in the user data directory.
   * @param event - The event object.
   * @param path - The path of the file to append to.
   * @param data - The data to append to the file.
   * @returns A promise that resolves when the file has been written.
   */
  ipcMain.handle('appendFile', async (_event, path: string, data: string) => {
    try {
      await fs.appendFileSync(join(userSpacePath, path), data, 'utf8')
    } catch (err) {
      console.error(`appendFile ${path} result: ${err}`)
    }
  })

  /**
   * Reads a file line by line.
   * @param event - The event object.
   * @param path - The path of the file to read.
   * @returns A promise that resolves with the contents of the file.
   */
  ipcMain.handle('readLineByLine', async (_event, path: string) => {
    const fullPath = join(userSpacePath, path)

    return new Promise((res, rej) => {
      try {
        const readInterface = readline.createInterface({
          input: fs.createReadStream(fullPath),
        })
        const lines: any = []
        readInterface
          .on('line', function (line) {
            lines.push(line)
          })
          .on('close', function () {
            res(lines)
          })
      } catch (err) {
        rej(err)
      }
    })
  })
}
