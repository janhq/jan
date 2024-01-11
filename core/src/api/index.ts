/**
 * App Route APIs
 * @description Enum of all the routes exposed by the app
 */
export enum AppRoute {
  appDataPath = 'appDataPath',
  openExternalUrl = 'openExternalUrl',
  openAppDirectory = 'openAppDirectory',
  openFileExplore = 'openFileExplorer',
  relaunch = 'relaunch',
  joinPath = 'joinPath',
  baseName = 'baseName',
  startServer = 'startServer',
  stopServer = 'stopServer',
  log = 'log'
}

export enum AppEvent {
  onAppUpdateDownloadUpdate = 'onAppUpdateDownloadUpdate',
  onAppUpdateDownloadError = 'onAppUpdateDownloadError',
  onAppUpdateDownloadSuccess = 'onAppUpdateDownloadSuccess',
}

export enum DownloadRoute {
  abortDownload = 'abortDownload',
  downloadFile = 'downloadFile',
  pauseDownload = 'pauseDownload',
  resumeDownload = 'resumeDownload',
}

export enum DownloadEvent {
  onFileDownloadUpdate = 'onFileDownloadUpdate',
  onFileDownloadError = 'onFileDownloadError',
  onFileDownloadSuccess = 'onFileDownloadSuccess',
}

export enum ExtensionRoute {
  baseExtensions = 'baseExtensions',
  getActiveExtensions = 'getActiveExtensions',
  installExtension = 'installExtension',
  invokeExtensionFunc = 'invokeExtensionFunc',
  updateExtension = 'updateExtension',
  uninstallExtension = 'uninstallExtension',
}
export enum FileSystemRoute {
  appendFileSync = 'appendFileSync',
  copyFileSync = 'copyFileSync',
  unlinkSync = 'unlinkSync',
  existsSync = 'existsSync',
  readdirSync = 'readdirSync',
  mkdirSync = 'mkdirSync',
  readFileSync = 'readFileSync',
  rmdirSync = 'rmdirSync',
  writeFileSync = 'writeFileSync',
}
export enum FileManagerRoute {
  syncFile = 'syncFile',
  getUserSpace = 'getUserSpace',
  getResourcePath = 'getResourcePath',
  fileStat = 'fileStat',
  writeBlob = 'writeBlob',
}

export type ApiFunction = (...args: any[]) => any

export type AppRouteFunctions = {
  [K in AppRoute]: ApiFunction
}

export type AppEventFunctions = {
  [K in AppEvent]: ApiFunction
}

export type DownloadRouteFunctions = {
  [K in DownloadRoute]: ApiFunction
}

export type DownloadEventFunctions = {
  [K in DownloadEvent]: ApiFunction
}

export type ExtensionRouteFunctions = {
  [K in ExtensionRoute]: ApiFunction
}

export type FileSystemRouteFunctions = {
  [K in FileSystemRoute]: ApiFunction
}

export type FileManagerRouteFunctions = {
  [K in FileManagerRoute]: ApiFunction
}

export type APIFunctions = AppRouteFunctions &
  AppEventFunctions &
  DownloadRouteFunctions &
  DownloadEventFunctions &
  ExtensionRouteFunctions &
  FileSystemRouteFunctions &
  FileManagerRoute

export const APIRoutes = [
  ...Object.values(AppRoute),
  ...Object.values(DownloadRoute),
  ...Object.values(ExtensionRoute),
  ...Object.values(FileSystemRoute),
  ...Object.values(FileManagerRoute),
]
export const APIEvents = [...Object.values(AppEvent), ...Object.values(DownloadEvent)]
