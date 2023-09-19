import { ipcRenderer, contextBridge } from "electron"

export default function useFacade() {
  const interfaces = {
    install(plugins) {
      return ipcRenderer.invoke('pluggable:install', plugins)
    },
    uninstall(plugins, reload) {
      return ipcRenderer.invoke('pluggable:uninstall', plugins, reload)
    },
    getActive() {
      return ipcRenderer.invoke('pluggable:getActivePlugins')
    },
    update(plugins, reload) {
      return ipcRenderer.invoke('pluggable:update', plugins, reload)
    },
    updatesAvailable(plugin) {
      return ipcRenderer.invoke('pluggable:updatesAvailable', plugin)
    },
    toggleActive(plugin, active) {
      return ipcRenderer.invoke('pluggable:togglePluginActive', plugin, active)
    },
  }

  if (contextBridge) {
    contextBridge.exposeInMainWorld('pluggableElectronIpc', interfaces)
  }

  return interfaces
}
