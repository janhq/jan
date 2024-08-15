import { join, resolve } from 'path'

import { existsSync, mkdirSync, writeFileSync } from 'fs'

/**
 * Manages extension installation and migration.
 */

export class ExtensionManager {
  public static instance: ExtensionManager = new ExtensionManager()

  private extensionsPath: string | undefined

  constructor() {
    if (ExtensionManager.instance) {
      return ExtensionManager.instance
    }
  }

  getExtensionsPath(): string | undefined {
    return this.extensionsPath
  }

  setExtensionsPath(extPath: string) {
    // Create folder if it does not exist
    let extDir
    try {
      extDir = resolve(extPath)
      if (extDir.length < 2) throw new Error()

      if (!existsSync(extDir)) mkdirSync(extDir)

      const extensionsJson = join(extDir, 'extensions.json')
      if (!existsSync(extensionsJson)) writeFileSync(extensionsJson, '{}')

      this.extensionsPath = extDir
    } catch (error) {
      throw new Error('Invalid path provided to the extensions folder')
    }
  }

  getExtensionsFile() {
    return join(this.extensionsPath ?? '', 'extensions.json')
  }
}
