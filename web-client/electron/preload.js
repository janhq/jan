/* eslint-disable react-hooks/rules-of-hooks */
// Make Pluggable Electron's facade available to the renderer on window.plugins
const { contextBridge, ipcRenderer } = require("electron");
// TODO: recheck if we need below code, since we have nodeIntegration enabled
const useFacade = require("pluggable-electron/facade");
useFacade();

contextBridge.exposeInMainWorld("electronAPI", {
  invokePluginSep: (plugin, method) =>
    ipcRenderer.send("invokePluginSep", plugin, method),
  sendInquiry: (question) => ipcRenderer.invoke("sendInquiry", question),
  initModel: (modelName) => ipcRenderer.invoke("initModel", modelName),
});
