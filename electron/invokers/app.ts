import { shell } from 'electron'

const { ipcRenderer } = require('electron')

export function appInvokers() {
  const interfaces = {
    /**
     * Sets the native theme to light.
     */
    setNativeThemeLight: () => ipcRenderer.invoke('setNativeThemeLight'),

    /**
     * Sets the native theme to dark.
     */
    setNativeThemeDark: () => ipcRenderer.invoke('setNativeThemeDark'),

    /**
     * Sets the native theme to system default.
     */
    setNativeThemeSystem: () => ipcRenderer.invoke('setNativeThemeSystem'),

    /**
     * Retrieves the application data path.
     * @returns {Promise<string>} A promise that resolves to the application data path.
     */
    appDataPath: () => ipcRenderer.invoke('appDataPath'),

    /**
     * Retrieves the application version.
     * @returns {Promise<string>} A promise that resolves to the application version.
     */
    appVersion: () => ipcRenderer.invoke('appVersion'),

    /**
     * Opens an external URL.
     * @param {string} url - The URL to open.
     * @returns {Promise<void>} A promise that resolves when the URL has been opened.
     */
    openExternalUrl: (url: string) =>
      ipcRenderer.invoke('openExternalUrl', url),

    /**
     * Relaunches the application.
     * @returns {Promise<void>} A promise that resolves when the application has been relaunched.
     */
    relaunch: () => ipcRenderer.invoke('relaunch'),

    /**
     * Opens the application directory.
     * @returns {Promise<void>} A promise that resolves when the application directory has been opened.
     */
    openAppDirectory: () => ipcRenderer.invoke('openAppDirectory'),

    /**
     * Opens the file explorer at a specific path.
     * @param {string} path - The path to open in the file explorer.
     */
    openFileExplorer: (path: string) => shell.openPath(path),
  }

  return interfaces
}
