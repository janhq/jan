import { app, ipcMain, webContents } from 'electron'
import { readdirSync, rmdir, writeFileSync } from 'fs'
import { ModuleManager } from '../managers/module'
import { join, extname } from 'path'
import { ExtensionManager } from '../managers/extension'
import { WindowManager } from '../managers/window'
import { manifest, tarball } from 'pacote'
import {
  getActiveExtensions,
  getAllExtensions,
  installExtensions,
} from '../extension/store'
import { getExtension } from '../extension/store'
import { removeExtension } from '../extension/store'
import Extension from '../extension/extension'
import { userSpacePath } from '../utils/path'

export function handleExtensionIPCs() {
  /**MARK: General handlers */
  /**
   * Invokes a function from a extension module in main node process.
   * @param _event - The IPC event object.
   * @param modulePath - The path to the extension module.
   * @param method - The name of the function to invoke.
   * @param args - The arguments to pass to the function.
   * @returns The result of the invoked function.
   */
  ipcMain.handle(
    'extension:invokeExtensionFunc',
    async (_event, modulePath, method, ...args) => {
      const module = require(
        /* webpackIgnore: true */ join(userSpacePath, 'extensions', modulePath)
      )
      ModuleManager.instance.setModule(modulePath, module)

      if (typeof module[method] === 'function') {
        return module[method](...args)
      } else {
        console.debug(module[method])
        console.error(`Function "${method}" does not exist in the module.`)
      }
    }
  )

  /**
   * Returns the paths of the base extensions.
   * @param _event - The IPC event object.
   * @returns An array of paths to the base extensions.
   */
  ipcMain.handle('extension:baseExtensions', async (_event) => {
    const baseExtensionPath = join(
      __dirname,
      '../',
      app.isPackaged ? '../../app.asar.unpacked/pre-install' : '../pre-install'
    )
    return readdirSync(baseExtensionPath)
      .filter((file) => extname(file) === '.tgz')
      .map((file) => join(baseExtensionPath, file))
  })

  /**
   * Returns the path to the user's extension directory.
   * @param _event - The IPC event extension.
   * @returns The path to the user's extension directory.
   */
  ipcMain.handle('extension:extensionPath', async (_event) => {
    return join(userSpacePath, 'extensions')
  })

  /**MARK: Extension Manager handlers */
  ipcMain.handle('extension:install', async (e, extensions) => {
    // Install and activate all provided extensions
    const installed = await installExtensions(extensions)
    return JSON.parse(JSON.stringify(installed))
  })

  // Register IPC route to uninstall a extension
  ipcMain.handle('extension:uninstall', async (e, extensions, reload) => {
    // Uninstall all provided extensions
    for (const ext of extensions) {
      const extension = getExtension(ext)
      await extension.uninstall()
      if (extension.name) removeExtension(extension.name)
    }

    // Reload all renderer pages if needed
    reload && webContents.getAllWebContents().forEach((wc) => wc.reload())
    return true
  })

  // Register IPC route to update a extension
  ipcMain.handle('extension:update', async (e, extensions, reload) => {
    // Update all provided extensions
    const updated: Extension[] = []
    for (const ext of extensions) {
      const extension = getExtension(ext)
      const res = await extension.update()
      if (res) updated.push(extension)
    }

    // Reload all renderer pages if needed
    if (updated.length && reload)
      webContents.getAllWebContents().forEach((wc) => wc.reload())

    return JSON.parse(JSON.stringify(updated))
  })

  // Register IPC route to check if updates are available for a extension
  ipcMain.handle('extension:updatesAvailable', (e, names) => {
    const extensions = names
      ? names.map((name: string) => getExtension(name))
      : getAllExtensions()

    const updates: Record<string, Extension> = {}
    for (const extension of extensions) {
      updates[extension.name] = extension.isUpdateAvailable()
    }
    return updates
  })

  // Register IPC route to get the list of active extensions
  ipcMain.handle('extension:getActiveExtensions', () => {
    return JSON.parse(JSON.stringify(getActiveExtensions()))
  })

  // Register IPC route to toggle the active state of a extension
  ipcMain.handle('extension:toggleExtensionActive', (e, plg, active) => {
    const extension = getExtension(plg)
    return JSON.parse(JSON.stringify(extension.setActive(active)))
  })
}
