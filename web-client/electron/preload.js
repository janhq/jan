/* eslint-disable react-hooks/rules-of-hooks */
// Make Pluggable Electron's facade available to hte renderer on window.plugins
const { contextBridge, ipcRenderer } = require("electron");
const useFacade = require("pluggable-electron/facade");
useFacade();

contextBridge.exposeInMainWorld("electronAPI", {
  invokePluginSep: (plugin, method) =>
    ipcRenderer.send("invokePluginSep", plugin, method),
});
