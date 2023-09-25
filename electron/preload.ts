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

  getDownloadedModels: () => ipcRenderer.invoke("getDownloadedModels"),

  getAvailableModels: () => ipcRenderer.invoke("getAvailableModels"),

  deleteModel: (path: string) => ipcRenderer.invoke("deleteModel", path),

  downloadModel: (url: string) => ipcRenderer.invoke("downloadModel", url),

  onModelDownloadUpdate: (callback: any) =>
    ipcRenderer.on("model-download-update", callback),

  onModelDownloadError: (callback: any) =>
    ipcRenderer.on("model-download-error", callback),
});
