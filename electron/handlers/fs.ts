import { ipcMain } from 'electron'
import * as fs from 'fs'
import fse from 'fs-extra'
import { join } from 'path'
import readline from 'readline'
import { userSpacePath } from './../utils/path'
import { FileSystemRoute } from '@janhq/core'
const reflect = require('@alumna/reflect')

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
    FileSystemRoute.getUserSpace,
    (): Promise<string> => Promise.resolve(userSpacePath)
  )

  /**
   * Checks whether the path is a directory.
   * @param event - The event object.
   * @param path - The path to check.
   * @returns A promise that resolves with a boolean indicating whether the path is a directory.
   */
  ipcMain.handle(
    FileSystemRoute.isDirectory,
    (_event, path: string): Promise<boolean> => {
      const fullPath = join(userSpacePath, path)
      return Promise.resolve(
        fs.existsSync(fullPath) && fs.lstatSync(fullPath).isDirectory()
      )
    }
  )

  /**
   * Reads a file from the user data directory.
   * @param event - The event object.
   * @param path - The path of the file to read.
   * @returns A promise that resolves with the contents of the file.
   */
  ipcMain.handle(
    FileSystemRoute.readFile,
    async (event, path: string): Promise<string> => {
      return new Promise((resolve, reject) => {
        fs.readFile(join(userSpacePath, path), 'utf8', (err, data) => {
          if (err) {
            reject(err)
          } else {
            resolve(data)
          }
        })
      })
    }
  )

  /**
   * Checks whether a file exists in the user data directory.
   * @param event - The event object.
   * @param path - The path of the file to check.
   * @returns A promise that resolves with a boolean indicating whether the file exists.
   */
  ipcMain.handle(FileSystemRoute.exists, async (_event, path: string) => {
    return new Promise((resolve, reject) => {
      const fullPath = join(userSpacePath, path)
      fs.existsSync(fullPath) ? resolve(true) : resolve(false)
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
    FileSystemRoute.writeFile,
    async (event, path: string, data: string): Promise<void> => {
      try {
        fs.writeFileSync(join(userSpacePath, path), data, 'utf8')
      } catch (err) {
        console.error(`writeFile ${path} result: ${err}`)
      }
    }
  )

  ipcMain.handle(
    FileSystemRoute.writeBlob,
    async (_event, path: string, data: string): Promise<void> => {
      try {
        const dataBuffer = Buffer.from(data, 'base64')
        fs.writeFileSync(join(userSpacePath, path), dataBuffer)
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
  ipcMain.handle(
    FileSystemRoute.mkdir,
    async (event, path: string): Promise<void> => {
      try {
        fs.mkdirSync(join(userSpacePath, path), { recursive: true })
      } catch (err) {
        console.error(`mkdir ${path} result: ${err}`)
      }
    }
  )

  /**
   * Removes a directory in the user data directory.
   * @param event - The event object.
   * @param path - The path of the directory to remove.
   * @returns A promise that resolves when the directory is removed successfully.
   */
  ipcMain.handle(
    FileSystemRoute.rmdir,
    async (event, path: string): Promise<void> => {
      try {
        await fs.rmSync(join(userSpacePath, path), { recursive: true })
      } catch (err) {
        console.error(`rmdir ${path} result: ${err}`)
      }
    }
  )

  /**
   * Lists the files in a directory in the user data directory.
   * @param event - The event object.
   * @param path - The path of the directory to list files from.
   * @returns A promise that resolves with an array of file names.
   */
  ipcMain.handle(
    FileSystemRoute.listFiles,
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
  ipcMain.handle(FileSystemRoute.deleteFile, async (_event, filePath) => {
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
  ipcMain.handle(
    FileSystemRoute.appendFile,
    async (_event, path: string, data: string) => {
      try {
        await fs.appendFileSync(join(userSpacePath, path), data, 'utf8')
      } catch (err) {
        console.error(`appendFile ${path} result: ${err}`)
      }
    }
  )

  ipcMain.handle(
    FileSystemRoute.syncFile,
    async (_event, src: string, dest: string) => {
      console.debug(`Copying file from ${src} to ${dest}`)

      return reflect({
        src,
        dest,
        recursive: true,
        delete: false,
        overwrite: true,
        errorOnExist: false,
      })
    }
  )

  ipcMain.handle(
    FileSystemRoute.copyFile,
    async (_event, src: string, dest: string) => {
      console.debug(`Copying file from ${src} to ${dest}`)

      return fse.copySync(src, dest, {
        overwrite: false,
        recursive: true,
        errorOnExist: false,
      })
    }
  )

  /**
   * Reads a file line by line.
   * @param event - The event object.
   * @param path - The path of the file to read.
   * @returns A promise that resolves with the contents of the file.
   */
  ipcMain.handle(
    FileSystemRoute.readLineByLine,
    async (_event, path: string) => {
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
    }
  )
}
