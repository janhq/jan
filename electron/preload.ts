/* eslint-disable react-hooks/rules-of-hooks */
// Make Pluggable Electron's facade available to the renderer on window.plugins
//@ts-ignore
const useFacade = require("pluggable-electron/facade");
useFacade();
//@ts-ignore
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  invokePluginFunc: (plugin: any, method: any, ...args: any[]) =>
    ipcRenderer.invoke("invokePluginFunc", plugin, method, ...args),

  userData: () => ipcRenderer.invoke("userData"),
  pluginPath: () => ipcRenderer.invoke("pluginPath"),

  sendInquiry: (question: string) =>
    ipcRenderer.invoke("sendInquiry", question),

  initModel: (product: any) => ipcRenderer.invoke("initModel", product),

  deleteFile: (filePath: string) => ipcRenderer.invoke("deleteFile", filePath),

  downloadFile: (url: string, path: string) =>
    ipcRenderer.invoke("downloadFile", url, path),

  onFileDownloadUpdate: (callback: any) =>
    ipcRenderer.on("FILE_DOWNLOAD_UPDATE", callback),

  onFileDownloadError: (callback: any) =>
    ipcRenderer.on("FILE_DOWNLOAD_ERROR", callback),

  onFileDownloadSuccess: (callback: any) =>
    ipcRenderer.on("FILE_DOWNLOAD_COMPLETE", callback),
});
