import { ipcMain, webContents } from 'electron'
import { readdirSync } from 'fs'
import { join, extname } from 'path'

import {
  installExtensions,
  getExtension,
  removeExtension,
  getActiveExtensions,
  ModuleManager
} from '@janhq/core/node'

import { getResourcePath, userSpacePath } from './../utils/path'
import { ExtensionRoute } from '@janhq/core'

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
    ExtensionRoute.invokeExtensionFunc,
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
  ipcMain.handle(ExtensionRoute.baseExtensions, async (_event) => {
    const baseExtensionPath = join(getResourcePath(), 'pre-install')
    return readdirSync(baseExtensionPath)
      .filter((file) => extname(file) === '.tgz')
      .map((file) => join(baseExtensionPath, file))
  })

  /**MARK: Extension Manager handlers */
  ipcMain.handle(ExtensionRoute.installExtension, async (e, extensions) => {
    // Install and activate all provided extensions
    const installed = await installExtensions(extensions)
    return JSON.parse(JSON.stringify(installed))
  })

  // Register IPC route to uninstall a extension
  ipcMain.handle(
    ExtensionRoute.uninstallExtension,
    async (e, extensions, reload) => {
      // Uninstall all provided extensions
      for (const ext of extensions) {
        const extension = getExtension(ext)
        await extension.uninstall()
        if (extension.name) removeExtension(extension.name)
      }

      // Reload all renderer pages if needed
      reload && webContents.getAllWebContents().forEach((wc) => wc.reload())
      return true
    }
  )

  // Register IPC route to update a extension
  ipcMain.handle(
    ExtensionRoute.updateExtension,
    async (e, extensions, reload) => {
      // Update all provided extensions
      const updated: any[] = []
      for (const ext of extensions) {
        const extension = getExtension(ext)
        const res = await extension.update()
        if (res) updated.push(extension)
      }

      // Reload all renderer pages if needed
      if (updated.length && reload)
        webContents.getAllWebContents().forEach((wc) => wc.reload())

      return JSON.parse(JSON.stringify(updated))
    }
  )

  // Register IPC route to get the list of active extensions
  ipcMain.handle(ExtensionRoute.getActiveExtensions, () => {
    return JSON.parse(JSON.stringify(getActiveExtensions()))
  })
}
