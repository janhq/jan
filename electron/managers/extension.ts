import { app } from 'electron'
import { init } from './../extension'
import { join, resolve } from 'path'
import { rmdir } from 'fs'
import Store from 'electron-store'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { userSpacePath } from './../utils/path'
/**
 * Manages extension installation and migration.
 */
export class ExtensionManager {
  public static instance: ExtensionManager = new ExtensionManager()

  extensionsPath: string | undefined = undefined

  constructor() {
    if (ExtensionManager.instance) {
      return ExtensionManager.instance
    }
  }

  /**
   * Sets up the extensions by initializing the `extensions` module with the `confirmInstall` and `extensionsPath` options.
   * The `confirmInstall` function always returns `true` to allow extension installation.
   * The `extensionsPath` option specifies the path to install extensions to.
   */
  setupExtensions() {
    init({
      // Function to check from the main process that user wants to install a extension
      confirmInstall: async (_extensions: string[]) => {
        return true
      },
      // Path to install extension to
      extensionsPath: join(userSpacePath, 'extensions'),
    })
  }

  /**
   * Migrates the extensions by deleting the `extensions` directory in the user data path.
   * If the `migrated_version` key in the `Store` object does not match the current app version,
   * the function deletes the `extensions` directory and sets the `migrated_version` key to the current app version.
   * @returns A Promise that resolves when the migration is complete.
   */
  migrateExtensions() {
    return new Promise((resolve) => {
      const store = new Store()
      if (store.get('migrated_version') !== app.getVersion()) {
        console.debug('start migration:', store.get('migrated_version'))
        const fullPath = join(userSpacePath, 'extensions')

        rmdir(fullPath, { recursive: true }, function (err) {
          if (err) console.error(err)
          store.set('migrated_version', app.getVersion())
          console.debug('migrate extensions done')
          resolve(undefined)
        })
      } else {
        resolve(undefined)
      }
    })
  }

  setExtensionsPath(extPath: string) {
    // Create folder if it does not exist
    let extDir
    try {
      extDir = resolve(extPath)
      if (extDir.length < 2) throw new Error()

      if (!existsSync(extDir)) mkdirSync(extDir)

      const extensionsJson = join(extDir, 'extensions.json')
      if (!existsSync(extensionsJson))
        writeFileSync(extensionsJson, '{}', 'utf8')

      this.extensionsPath = extDir
    } catch (error) {
      throw new Error('Invalid path provided to the extensions folder')
    }
  }

  getExtensionsFile() {
    return join(this.extensionsPath ?? '', 'extensions.json')
  }
}
