/**
 * App Route APIs
 * @description Enum of all the routes exposed by the app
 */
export enum AppRoute {
  appDataPath = 'appDataPath',
  appVersion = 'appVersion',
  getResourcePath = 'getResourcePath',
  openExternalUrl = 'openExternalUrl',
  openAppDirectory = 'openAppDirectory',
  openFileExplore = 'openFileExplorer',
  relaunch = 'relaunch',
  joinPath = 'joinPath'
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
  getResourcePath = 'getResourcePath',
  getUserSpace = 'getUserSpace',
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

export type APIFunctions = AppRouteFunctions &
  AppEventFunctions &
  DownloadRouteFunctions &
  DownloadEventFunctions &
  ExtensionRouteFunctions &
  FileSystemRouteFunctions

export const APIRoutes = [
  ...Object.values(AppRoute),
  ...Object.values(DownloadRoute),
  ...Object.values(ExtensionRoute),
  ...Object.values(FileSystemRoute),
]
export const APIEvents = [...Object.values(AppEvent), ...Object.values(DownloadEvent)]
