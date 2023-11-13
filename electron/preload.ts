/**
 * Exposes a set of APIs to the renderer process via the contextBridge object.
 * @remarks
 * This module is used to make Pluggable Electron's facade available to the renderer on window.plugins.
 * @module preload
 */

/**
 * Exposes a set of APIs to the renderer process via the contextBridge object.
 * @remarks
 * This module is used to make Pluggable Electron's facade available to the renderer on window.plugins.
 * @function useFacade
 * @memberof module:preload
 * @returns {void}
 */

/**
 * Exposes a set of APIs to the renderer process via the contextBridge object.
 * @remarks
 * This module is used to make Pluggable Electron's facade available to the renderer on window.plugins.
 * @namespace electronAPI
 * @memberof module:preload
 * @property {Function} invokePluginFunc - Invokes a plugin function with the given arguments.
 * @property {Function} setNativeThemeLight - Sets the native theme to light.
 * @property {Function} setNativeThemeDark - Sets the native theme to dark.
 * @property {Function} setNativeThemeSystem - Sets the native theme to system.
 * @property {Function} basePlugins - Returns the base plugins.
 * @property {Function} pluginPath - Returns the plugin path.
 * @property {Function} appDataPath - Returns the app data path.
 * @property {Function} reloadPlugins - Reloads the plugins.
 * @property {Function} appVersion - Returns the app version.
 * @property {Function} openExternalUrl - Opens the given URL in the default browser.
 * @property {Function} relaunch - Relaunches the app.
 * @property {Function} openAppDirectory - Opens the app directory.
 * @property {Function} deleteFile - Deletes the file at the given path.
 * @property {Function} readFile - Reads the file at the given path.
 * @property {Function} writeFile - Writes the given data to the file at the given path.
 * @property {Function} listFiles - Lists the files in the directory at the given path.
 * @property {Function} mkdir - Creates a directory at the given path.
 * @property {Function} rmdir - Removes a directory at the given path recursively.
 * @property {Function} installRemotePlugin - Installs the remote plugin with the given name.
 * @property {Function} downloadFile - Downloads the file at the given URL to the given path.
 * @property {Function} pauseDownload - Pauses the download of the file with the given name.
 * @property {Function} resumeDownload - Resumes the download of the file with the given name.
 * @property {Function} abortDownload - Aborts the download of the file with the given name.
 * @property {Function} onFileDownloadUpdate - Registers a callback to be called when a file download is updated.
 * @property {Function} onFileDownloadError - Registers a callback to be called when a file download encounters an error.
 * @property {Function} onFileDownloadSuccess - Registers a callback to be called when a file download is completed successfully.
 * @property {Function} onAppUpdateDownloadUpdate - Registers a callback to be called when an app update download is updated.
 * @property {Function} onAppUpdateDownloadError - Registers a callback to be called when an app update download encounters an error.
 * @property {Function} onAppUpdateDownloadSuccess - Registers a callback to be called when an app update download is completed successfully.
 */

// Make Pluggable Electron's facade available to the renderer on window.plugins
import { useFacade } from "./core/plugin/facade";

useFacade();

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  invokePluginFunc: (plugin: any, method: any, ...args: any[]) =>
    ipcRenderer.invoke("invokePluginFunc", plugin, method, ...args),

  setNativeThemeLight: () => ipcRenderer.invoke("setNativeThemeLight"),

  setNativeThemeDark: () => ipcRenderer.invoke("setNativeThemeDark"),

  setNativeThemeSystem: () => ipcRenderer.invoke("setNativeThemeSystem"),

  basePlugins: () => ipcRenderer.invoke("basePlugins"),

  pluginPath: () => ipcRenderer.invoke("pluginPath"),

  appDataPath: () => ipcRenderer.invoke("appDataPath"),

  reloadPlugins: () => ipcRenderer.invoke("reloadPlugins"),

  appVersion: () => ipcRenderer.invoke("appVersion"),

  openExternalUrl: (url: string) => ipcRenderer.invoke("openExternalUrl", url),

  relaunch: () => ipcRenderer.invoke("relaunch"),

  openAppDirectory: () => ipcRenderer.invoke("openAppDirectory"),

  deleteFile: (filePath: string) => ipcRenderer.invoke("deleteFile", filePath),

  readFile: (path: string) => ipcRenderer.invoke("readFile", path),

  writeFile: (path: string, data: string) =>
    ipcRenderer.invoke("writeFile", path, data),

  listFiles: (path: string) => ipcRenderer.invoke("listFiles", path),

  mkdir: (path: string) => ipcRenderer.invoke("mkdir", path),

  rmdir: (path: string) => ipcRenderer.invoke("rmdir", path),

  installRemotePlugin: (pluginName: string) =>
    ipcRenderer.invoke("installRemotePlugin", pluginName),

  downloadFile: (url: string, path: string) =>
    ipcRenderer.invoke("downloadFile", url, path),

  pauseDownload: (fileName: string) =>
    ipcRenderer.invoke("pauseDownload", fileName),

  resumeDownload: (fileName: string) =>
    ipcRenderer.invoke("resumeDownload", fileName),

  abortDownload: (fileName: string) =>
    ipcRenderer.invoke("abortDownload", fileName),

  onFileDownloadUpdate: (callback: any) =>
    ipcRenderer.on("FILE_DOWNLOAD_UPDATE", callback),

  onFileDownloadError: (callback: any) =>
    ipcRenderer.on("FILE_DOWNLOAD_ERROR", callback),

  onFileDownloadSuccess: (callback: any) =>
    ipcRenderer.on("FILE_DOWNLOAD_COMPLETE", callback),

  onAppUpdateDownloadUpdate: (callback: any) =>
    ipcRenderer.on("APP_UPDATE_PROGRESS", callback),

  onAppUpdateDownloadError: (callback: any) =>
    ipcRenderer.on("APP_UPDATE_ERROR", callback),

  onAppUpdateDownloadSuccess: (callback: any) =>
    ipcRenderer.on("APP_UPDATE_COMPLETE", callback),
});
