/**
 * App Route APIs
 * @description Enum of all the routes exposed by the app
 */
export enum AppRoute {
  openExternalUrl = 'openExternalUrl',
  openAppDirectory = 'openAppDirectory',
  openFileExplore = 'openFileExplorer',
  selectDirectory = 'selectDirectory',
  getAppConfigurations = 'getAppConfigurations',
  updateAppConfiguration = 'updateAppConfiguration',
  relaunch = 'relaunch',
  joinPath = 'joinPath',
  isSubdirectory = 'isSubdirectory',
  baseName = 'baseName',
  startServer = 'startServer',
  stopServer = 'stopServer',
  log = 'log',
  logServer = 'logServer',
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
  getDownloadProgress = 'getDownloadProgress',
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
  getJanDataFolderPath = 'getJanDataFolderPath',
  getResourcePath = 'getResourcePath',
  getUserHomePath = 'getUserHomePath',
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
