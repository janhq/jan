/* eslint-disable react-hooks/rules-of-hooks */
// Make Pluggable Electron's facade available to the renderer on window.plugins
const useFacade = require("pluggable-electron/facade");
useFacade();

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  invokePluginFunc: (plugin, method, ...args) =>
    ipcRenderer.invoke("invokePluginFunc", plugin, method, ...args),

  sendInquiry: (question) => ipcRenderer.invoke("sendInquiry", question),

  initModel: (modelName) => ipcRenderer.invoke("initModel", modelName),

  getDownloadedModels: () => ipcRenderer.invoke("getDownloadedModels"),

  getAvailableModels: () => ipcRenderer.invoke("getAvailableModels"),

  deleteModel: (path) => ipcRenderer.invoke("deleteModel", path),

  downloadModel: (url) => ipcRenderer.invoke("downloadModel", url),

  onModelDownloadUpdate: (callback) =>
    ipcRenderer.on("model-download-update", callback),

  onModelDownloadError: (callback) =>
    ipcRenderer.on("model-download-error", callback),
});
