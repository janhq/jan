// Make Pluggable Electron's facade available to the renderer on window.plugins
import { useFacade } from "./core/plugin/facade";
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

  appDataPath: () => ipcRenderer.invoke("appDataPath"),

  reloadPlugins: () => ipcRenderer.invoke("reloadPlugins"),

  appVersion: () => ipcRenderer.invoke("appVersion"),

  openExternalUrl: (url: string) => ipcRenderer.invoke("openExternalUrl", url),

  relaunch: () => ipcRenderer.invoke("relaunch"),

  openAppDirectory: () => ipcRenderer.invoke("openAppDirectory"),

  deleteFile: (filePath: string) => ipcRenderer.invoke("deleteFile", filePath),

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
