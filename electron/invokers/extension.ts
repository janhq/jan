const { ipcRenderer } = require('electron')

export function extensionInvokers() {
  const interfaces = {
    /**
     * Installs the given extensions.
     * @param {any[]} extensions - The extensions to install.
     */
    install(extensions: any[]) {
      return ipcRenderer.invoke('extension:install', extensions)
    },
    /**
     * Uninstalls the given extensions.
     * @param {any[]} extensions - The extensions to uninstall.
     * @param {boolean} reload - Whether to reload after uninstalling.
     */
    uninstall(extensions: any[], reload: boolean) {
      return ipcRenderer.invoke('extension:uninstall', extensions, reload)
    },
    /**
     * Retrieves the active extensions.
     */
    getActive() {
      return ipcRenderer.invoke('extension:getActiveExtensions')
    },
    /**
     * Updates the given extensions.
     * @param {any[]} extensions - The extensions to update.
     * @param {boolean} reload - Whether to reload after updating.
     */
    update(extensions: any[], reload: boolean) {
      return ipcRenderer.invoke('extension:update', extensions, reload)
    },
    /**
     * Checks if updates are available for the given extension.
     * @param {any} extension - The extension to check for updates.
     */
    updatesAvailable(extension: any) {
      return ipcRenderer.invoke('extension:updatesAvailable', extension)
    },
    /**
     * Toggles the active state of the given extension.
     * @param {any} extension - The extension to toggle.
     * @param {boolean} active - The new active state.
     */
    toggleActive(extension: any, active: boolean) {
      return ipcRenderer.invoke(
        'extension:toggleExtensionActive',
        extension,
        active
      )
    },

    /**
     * Invokes a function of the given extension.
     * @param {any} extension - The extension whose function should be invoked.
     * @param {any} method - The function to invoke.
     * @param {any[]} args - The arguments to pass to the function.
     */
    invokeExtensionFunc: (extension: any, method: any, ...args: any[]) =>
      ipcRenderer.invoke(
        'extension:invokeExtensionFunc',
        extension,
        method,
        ...args
      ),
    /**
     * Retrieves the base extensions.
     */
    baseExtensions: () => ipcRenderer.invoke('extension:baseExtensions'),
    /**
     * Retrieves the extension path.
     */
    extensionPath: () => ipcRenderer.invoke('extension:extensionPath'),
  }

  return interfaces
}
