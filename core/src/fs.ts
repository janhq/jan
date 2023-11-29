const fetchRetry = require("fetch-retry")(global.fetch);

const PORT = 1337;
const LOCAL_HOST = "127.0.0.1";
const JAN_HTTP_SERVER_URL = `http://${LOCAL_HOST}:${PORT}`;
const JAN_FS_API = `${JAN_HTTP_SERVER_URL}/fs`;
/**
 * Writes data to a file at the specified path.
 * @param {string} path - The path to the file.
 * @param {string} data - The data to write to the file.
 * @returns {Promise<any>} A Promise that resolves when the file is written successfully.
 */
const writeFile = (path: string, data: string): Promise<any> => {
  return fetchRetry(JAN_FS_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      op: 'writeFile',
      path,
      data
    }),
    retries: 3,
    retryDelay: 500,
  }).catch((err: any) => {
    console.error(err);
    throw new Error(`writeFile: ${path} failed`);
  })
}
  
/**
 * Checks whether the path is a directory.
 * @param path - The path to check.
 * @returns {boolean} A boolean indicating whether the path is a directory.
 */
const isDirectory = (path: string): Promise<boolean> => {
  return fetchRetry(JAN_FS_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      op: 'isDirectory',
      path,
    }),
    retries: 3,
    retryDelay: 500,
  }).catch((err: any) => {
    console.error(err);
    throw new Error(`isDirectory: ${path} failed`);
  })
}

/**
 * Reads the contents of a file at the specified path.
 * @param {string} path - The path of the file to read.
 * @returns {Promise<any>} A Promise that resolves with the contents of the file.
 */
const readFile = (path: string): Promise<any> => {
  return fetchRetry(JAN_FS_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      op: 'readFile',
      path,
    }),
    retries: 3,
    retryDelay: 500,
  }).catch((err: any) => {
    console.error(err);
    throw new Error(`readFile: ${path} failed`);
  })
}

/**
 * List the directory files
 * @param {string} path - The path of the directory to list files.
 * @returns {Promise<any>} A Promise that resolves with the contents of the directory.
 */
const listFiles = (path: string): Promise<any> => {
  return fetchRetry(JAN_FS_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      op: 'listFiles',
      path,
    }),
    retries: 3,
    retryDelay: 500,
  }).catch((err: any) => {
    console.error(err);
    throw new Error(`listFiles: ${path} failed`);
  })
}

/**
 * Creates a directory at the specified path.
 * @param {string} path - The path of the directory to create.
 * @returns {Promise<any>} A Promise that resolves when the directory is created successfully.
 */
const mkdir = (path: string): Promise<any> => {
  return fetchRetry(JAN_FS_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      op: 'mkdir',
      path,
    }),
    retries: 3,
    retryDelay: 500,
  }).catch((err: any) => {
    console.error(err);
    throw new Error(`mkdir: ${path} failed`);
  })
}

/**
 * Removes a directory at the specified path.
 * @param {string} path - The path of the directory to remove.
 * @returns {Promise<any>} A Promise that resolves when the directory is removed successfully.
 */
const rmdir = (path: string): Promise<any> => {
  return fetchRetry(JAN_FS_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      op: 'rmdir',
      path,
    }),
    retries: 3,
    retryDelay: 500,
  }).catch((err: any) => {
    console.error(err);
    throw new Error(`rmdir: ${path} failed`);
  })
}
/**
 * Deletes a file from the local file system.
 * @param {string} path - The path of the file to delete.
 * @returns {Promise<any>} A Promise that resolves when the file is deleted.
 */
const deleteFile = (path: string): Promise<any> => {
  return fetchRetry(JAN_FS_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      op: 'deleteFile',
      path,
    }),
    retries: 3,
    retryDelay: 500,
  }).catch((err: any) => {
    console.error(err);
    throw new Error(`deleteFile: ${path} failed`);
  })
}

export const fs = {
  isDirectory,
  writeFile,
  readFile,
  listFiles,
  mkdir,
  rmdir,
  deleteFile,
};
