// Make Pluggable Electron's facade available to the renderer on window.plugins
//@ts-ignore
const useFacade = require("../core/plugin-manager/facade");
useFacade();
//@ts-ignore
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  invokePluginFunc: (plugin: any, method: any, ...args: any[]) =>
    ipcRenderer.invoke("invokePluginFunc", plugin, method, ...args),

  setNativeThemeLight: () => ipcRenderer.invoke("setNativeThemeLight"),

  setNativeThemeDark: () => ipcRenderer.invoke("setNativeThemeDark"),

  setNativeThemeSystem: () => ipcRenderer.invoke("setNativeThemeSystem"),

  basePlugins: () => ipcRenderer.invoke("basePlugins"),

  pluginPath: () => ipcRenderer.invoke("pluginPath"),

  reloadPlugins: () => ipcRenderer.invoke("reloadPlugins"),

  appVersion: () => ipcRenderer.invoke("appVersion"),

  openExternalUrl: (url: string) => ipcRenderer.invoke("openExternalUrl", url),

  relaunch: () => ipcRenderer.invoke("relaunch"),

  deleteFile: (filePath: string) => ipcRenderer.invoke("deleteFile", filePath),

  installRemotePlugin: (pluginName: string) =>
    ipcRenderer.invoke("installRemotePlugin", pluginName),

  downloadFile: (url: string, path: string) =>
    ipcRenderer.invoke("downloadFile", url, path),

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
