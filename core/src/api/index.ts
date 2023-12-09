/**
 * App Route APIs
 * @description Enum of all the routes exposed by the app
 */
export enum AppRoute {
  setNativeThemeLight = 'setNativeThemeLight',
  setNativeThemeDark = 'setNativeThemeDark',
  setNativeThemeSystem = 'setNativeThemeSystem',
  appDataPath = 'appDataPath',
  appVersion = 'appVersion',
  openExternalUrl = 'openExternalUrl',
  relaunch = 'relaunch',
  openAppDirectory = 'openAppDirectory',
  openFileExplore = 'openFileExplorer',
  getResourcePath = 'getResourcePath',
}

export enum AppEvent {
  onAppUpdateDownloadUpdate = 'onAppUpdateDownloadUpdate',
  onAppUpdateDownloadError = 'onAppUpdateDownloadError',
  onAppUpdateDownloadSuccess = 'onAppUpdateDownloadSuccess',
}

export enum DownloadRoute {
  downloadFile = 'downloadFile',
  pauseDownload = 'pauseDownload',
  resumeDownload = 'resumeDownload',
  abortDownload = 'abortDownload',
}

export enum DownloadEvent {
  onFileDownloadUpdate = 'onFileDownloadUpdate',
  onFileDownloadError = 'onFileDownloadError',
  onFileDownloadSuccess = 'onFileDownloadSuccess',
}

export enum ExtensionRoute {
  installExtension = 'installExtension',
  uninstallExtension = 'uninstallExtension',
  getActiveExtensions = 'getActiveExtensions',
  updateExtension = 'updateExtension',
  invokeExtensionFunc = 'invokeExtensionFunc',
  baseExtensions = 'baseExtensions',
  extensionPath = 'extensionPath',
}
export enum FileSystemRoute {
  deleteFile = 'deleteFile',
  isDirectory = 'isDirectory',
  getUserSpace = 'getUserSpace',
  readFile = 'readFile',
  writeFile = 'writeFile',
  listFiles = 'listFiles',
  appendFile = 'appendFile',
  readLineByLine = 'readLineByLine',
  mkdir = 'mkdir',
  rmdir = 'rmdir',
  copyFile = 'copyFile',
  getResourcePath = 'getResourcePath',
  exists = 'exists',
}
