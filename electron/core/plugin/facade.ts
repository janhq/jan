const { ipcRenderer, contextBridge } = require("electron");

export function useFacade() {
  const interfaces = {
    install(plugins: any[]) {
      return ipcRenderer.invoke("pluggable:install", plugins);
    },
    uninstall(plugins: any[], reload: boolean) {
      return ipcRenderer.invoke("pluggable:uninstall", plugins, reload);
    },
    getActive() {
      return ipcRenderer.invoke("pluggable:getActivePlugins");
    },
    update(plugins: any[], reload: boolean) {
      return ipcRenderer.invoke("pluggable:update", plugins, reload);
    },
    updatesAvailable(plugin: any) {
      return ipcRenderer.invoke("pluggable:updatesAvailable", plugin);
    },
    toggleActive(plugin: any, active: boolean) {
      return ipcRenderer.invoke("pluggable:togglePluginActive", plugin, active);
    },
  };

  if (contextBridge) {
    contextBridge.exposeInMainWorld("pluggableElectronIpc", interfaces);
  }

  return interfaces;
}
