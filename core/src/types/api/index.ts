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
  homePath = 'homePath',
  getThemes = 'getThemes',
  readTheme = 'readTheme',

  // used for migration. Please remove this later on.
  getAllMessagesAndThreads = 'getAllMessagesAndThreads',
  syncModelFileToCortex = 'syncModelFileToCortex',
}

export enum AppEvent {
  onAppUpdateDownloadUpdate = 'onAppUpdateDownloadUpdate',
  onAppUpdateDownloadError = 'onAppUpdateDownloadError',
  onAppUpdateDownloadSuccess = 'onAppUpdateDownloadSuccess',

  onUserSubmitQuickAsk = 'onUserSubmitQuickAsk',
  onSelectedText = 'onSelectedText',

  onDeepLink = 'onDeepLink',
}

export enum LocalImportModelEvent {
  onLocalImportModelUpdate = 'onLocalImportModelUpdate',
  onLocalImportModelFailed = 'onLocalImportModelFailed',
  onLocalImportModelSuccess = 'onLocalImportModelSuccess',
  onLocalImportModelFinished = 'onLocalImportModelFinished',
}

export type ApiFunction = (...args: any[]) => any

export type NativeRouteFunctions = {
  [K in NativeRoute]: ApiFunction
}

export type AppEventFunctions = {
  [K in AppEvent]: ApiFunction
}

export type APIFunctions = NativeRouteFunctions & AppEventFunctions

export const APIRoutes = [...Object.values(NativeRoute)]
export const APIEvents = [...Object.values(AppEvent), ...Object.values(LocalImportModelEvent)]
