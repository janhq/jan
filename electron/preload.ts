/**
 * Exposes a set of APIs to the renderer process via the contextBridge object.
 * @module preload
 */
const { contextBridge } = require('electron')

const { ipcRenderer } = require('electron')

// TODO: Add types / class definition instead of keys
const ipcMethods = [
  // App
  'setNativeThemeLight',
  'setNativeThemeDark',
  'setNativeThemeSystem',
  'appDataPath',
  'appVersion',
  'openExternalUrl',
  'relaunch',
  'openAppDirectory',
  'openFileExplorer',

  // Downloader
  'downloadFile',
  'pauseDownload',
  'resumeDownload',
  'abortDownload',

  // Extension
  'installExtension',
  'uninstallExtension',
  'getActiveExtensions',
  'updateExtension',
  'invokeExtensionFunc',
  'baseExtensions',
  'extensionPath',

  // Filesystem
  'deleteFile',
  'isDirectory',
  'getUserSpace',
  'readFile',
  'writeFile',
  'listFiles',
  'appendFile',
  'readLineByLine',
  'mkdir',
  'rmdir',
  'copyFile',
  'getResourcePath',
  'exists',
]

const ipcEvents = [
  // Downloader
  'onFileDownloadUpdate',
  'onFileDownloadError',
  'onFileDownloadSuccess',
  // App Update
  'onAppUpdateDownloadUpdate',
  'onAppUpdateDownloadError',
  'onAppUpdateDownloadSuccess',
]

const interfaces: { [key: string]: (...args: any[]) => any } = {}

ipcMethods.forEach((method) => {
  interfaces[method] = (...args: any[]) => ipcRenderer.invoke(method, ...args)
})

ipcEvents.forEach((method) => {
  interfaces[method] = (handler: any) => ipcRenderer.on(method, handler)
})

contextBridge.exposeInMainWorld('electronAPI', {
  ...interfaces,
})
