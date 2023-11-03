import { app, ipcMain } from "electron";
import * as fs from "fs";
import { join } from "path";

/**
 * Handles file system operations.
 */
export function handleFs() {
  /**
   * Reads a file from the user data directory.
   * @param event - The event object.
   * @param path - The path of the file to read.
   * @returns A promise that resolves with the contents of the file.
   */
  ipcMain.handle("readFile", async (event, path: string): Promise<string> => {
    return new Promise((resolve, reject) => {
      fs.readFile(join(app.getPath("userData"), path), "utf8", (err, data) => {
        if (err) {
          reject(err);
        } else {
          resolve(data);
        }
      });
    });
  });

  /**
   * Writes data to a file in the user data directory.
   * @param event - The event object.
   * @param path - The path of the file to write to.
   * @param data - The data to write to the file.
   * @returns A promise that resolves when the file has been written.
   */
  ipcMain.handle(
    "writeFile",
    async (event, path: string, data: string): Promise<void> => {
      return new Promise((resolve, reject) => {
        fs.writeFile(
          join(app.getPath("userData"), path),
          data,
          "utf8",
          (err) => {
            if (err) {
              reject(err);
            } else {
              resolve();
            }
          }
        );
      });
    }
  );

  /**
   * Creates a directory in the user data directory.
   * @param event - The event object.
   * @param path - The path of the directory to create.
   * @returns A promise that resolves when the directory has been created.
   */
  ipcMain.handle("mkdir", async (event, path: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      fs.mkdir(
        join(app.getPath("userData"), path),
        { recursive: true },
        (err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        }
      );
    });
  });

  /**
   * Lists the files in a directory in the user data directory.
   * @param event - The event object.
   * @param path - The path of the directory to list files from.
   * @returns A promise that resolves with an array of file names.
   */
  ipcMain.handle(
    "listFiles",
    async (event, path: string): Promise<string[]> => {
      return new Promise((resolve, reject) => {
        fs.readdir(join(app.getPath("userData"), path), (err, files) => {
          if (err) {
            reject(err);
          } else {
            resolve(files);
          }
        });
      });
    }
  );
}
