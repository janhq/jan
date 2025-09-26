import { ChatCompletionMessage } from '../inference'

/**
 * Native Route APIs
 * @description Enum of all the routes exposed by the app
 */
export enum NativeRoute {
  openExternalUrl = 'openExternalUrl',
  openAppDirectory = 'openAppDirectory',
  openFileExplore = 'openFileExplorer',
  selectDirectory = 'selectDirectory',
  selectFiles = 'selectFiles',
  relaunch = 'relaunch',
  setNativeThemeLight = 'setNativeThemeLight',
  setNativeThemeDark = 'setNativeThemeDark',

  setMinimizeApp = 'setMinimizeApp',
  setCloseApp = 'setCloseApp',
  setMaximizeApp = 'setMaximizeApp',
  showOpenMenu = 'showOpenMenu',

  hideQuickAskWindow = 'hideQuickAskWindow',
  sendQuickAskInput = 'sendQuickAskInput',

  hideMainWindow = 'hideMainWindow',
  showMainWindow = 'showMainWindow',

  quickAskSizeUpdated = 'quickAskSizeUpdated',
  ackDeepLink = 'ackDeepLink',
  factoryReset = 'factoryReset',

  startServer = 'startServer',
  stopServer = 'stopServer',

  appUpdateDownload = 'appUpdateDownload',

  appToken = 'appToken',
}

/**
 * App Route APIs
 * @description Enum of all the routes exposed by the app
 */
export enum AppRoute {
  getAppConfigurations = 'getAppConfigurations',
  updateAppConfiguration = 'updateAppConfiguration',
  joinPath = 'joinPath',
  dirName = 'dirName',
  isSubdirectory = 'isSubdirectory',
  baseName = 'baseName',
  log = 'log',
  showToast = 'showToast',
}

export enum AppEvent {
  onAppUpdateNotAvailable = 'onAppUpdateNotAvailable',
  onAppUpdateAvailable = 'onAppUpdateAvailable',
  onAppUpdateDownloadUpdate = 'onAppUpdateDownloadUpdate',
  onAppUpdateDownloadError = 'onAppUpdateDownloadError',
  onAppUpdateDownloadSuccess = 'onAppUpdateDownloadSuccess',
  onModelImported = 'onModelImported',

  onUserSubmitQuickAsk = 'onUserSubmitQuickAsk',
  onSelectedText = 'onSelectedText',

  onDeepLink = 'onDeepLink',
  onMainViewStateChange = 'onMainViewStateChange',
}

export enum DownloadEvent {
  onFileDownloadUpdate = 'onFileDownloadUpdate',
  onFileDownloadError = 'onFileDownloadError',
  onFileDownloadSuccess = 'onFileDownloadSuccess',
  onFileDownloadStopped = 'onFileDownloadStopped',
  onFileDownloadStarted = 'onFileDownloadStarted',
  onModelValidationStarted = 'onModelValidationStarted',
  onModelValidationFailed = 'onModelValidationFailed',
  onFileDownloadAndVerificationSuccess = 'onFileDownloadAndVerificationSuccess',
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
  unlinkSync = 'unlinkSync',
  existsSync = 'existsSync',
  readdirSync = 'readdirSync',
  rm = 'rm',
  mv = 'mv',
  mkdir = 'mkdir',
  readFileSync = 'readFileSync',
  writeFileSync = 'writeFileSync',
}
export enum FileManagerRoute {
  copyFile = 'copyFile',
  getJanDataFolderPath = 'getJanDataFolderPath',
  getResourcePath = 'getResourcePath',
  getUserHomePath = 'getUserHomePath',
  fileStat = 'fileStat',
  writeBlob = 'writeBlob',
  getGgufFiles = 'getGgufFiles',
}

export type ApiFunction = (...args: any[]) => any

export type NativeRouteFunctions = {
  [K in NativeRoute]: ApiFunction
}

export type AppRouteFunctions = {
  [K in AppRoute]: ApiFunction
}

export type AppEventFunctions = {
  [K in AppEvent]: ApiFunction
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

export type APIFunctions = NativeRouteFunctions &
  AppRouteFunctions &
  AppEventFunctions &
  DownloadEventFunctions &
  ExtensionRouteFunctions &
  FileSystemRouteFunctions &
  FileManagerRoute

export const CoreRoutes = [
  ...Object.values(AppRoute),
  ...Object.values(ExtensionRoute),
  ...Object.values(FileSystemRoute),
  ...Object.values(FileManagerRoute),
]

export const APIRoutes = [...CoreRoutes, ...Object.values(NativeRoute)]
export const APIEvents = [...Object.values(AppEvent), ...Object.values(DownloadEvent)]
export type PayloadType = {
  messages: ChatCompletionMessage[]
  model: string
  stream: boolean
}
