/* eslint-disable react-hooks/rules-of-hooks */
// Make Pluggable Electron's facade available to the renderer on window.plugins
const useFacade = require("pluggable-electron/facade");
useFacade();

// TODO: recheck if we need below code, since we have nodeIntegration enabled
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("electronAPI", {
  invokePluginFunc: (plugin, method, ...args) =>
    ipcRenderer.invoke("invokePluginFunc", plugin, method, ...args),
  sendInquiry: (question) => ipcRenderer.invoke("sendInquiry", question),
  initModel: (modelName) => ipcRenderer.invoke("initModel", modelName),
});
