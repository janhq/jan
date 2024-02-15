import { readdirSync } from 'fs'
import { join, extname } from 'path'

import { Processor } from './Processor'
import { ModuleManager } from '../../helper/module'
import { getJanExtensionsPath as getPath } from '../../helper'
import {
  getActiveExtensions as getExtensions,
  getExtension,
  removeExtension,
  installExtensions,
} from '../../extension/store'
import { appResourcePath } from '../../helper/path'

export class Extension implements Processor {
  observer?: Function

  constructor(observer?: Function) {
    this.observer = observer
  }

  process(key: string, ...args: any[]): any {
    const instance = this as any
    const func = instance[key]
    return func(...args)
  }

  invokeExtensionFunc(modulePath: string, method: string, ...params: any[]) {
    const module = require(join(getPath(), modulePath))
    ModuleManager.instance.setModule(modulePath, module)

    if (typeof module[method] === 'function') {
      return module[method](...params)
    } else {
      console.debug(module[method])
      console.error(`Function "${method}" does not exist in the module.`)
    }
  }

  /**
   * Returns the paths of the base extensions.
   * @returns An array of paths to the base extensions.
   */
  async baseExtensions() {
    const baseExtensionPath = join(await appResourcePath(), 'pre-install')
    return readdirSync(baseExtensionPath)
      .filter((file) => extname(file) === '.tgz')
      .map((file) => join(baseExtensionPath, file))
  }

  /**MARK: Extension Manager handlers */
  async installExtension(extensions: any) {
    // Install and activate all provided extensions
    const installed = await installExtensions(extensions)
    return JSON.parse(JSON.stringify(installed))
  }

  // Register IPC route to uninstall a extension
  async uninstallExtension(extensions: any) {
    // Uninstall all provided extensions
    for (const ext of extensions) {
      const extension = getExtension(ext)
      await extension.uninstall()
      if (extension.name) removeExtension(extension.name)
    }

    // Reload all renderer pages if needed
    return true
  }

  // Register IPC route to update a extension
  async updateExtension(extensions: any) {
    // Update all provided extensions
    const updated: any[] = []
    for (const ext of extensions) {
      const extension = getExtension(ext)
      const res = await extension.update()
      if (res) updated.push(extension)
    }

    // Reload all renderer pages if needed
    return JSON.parse(JSON.stringify(updated))
  }

  getActiveExtensions() {
    return JSON.parse(JSON.stringify(getExtensions()))
  }
}
