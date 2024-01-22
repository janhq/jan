import { app } from 'electron'

import { rmdir } from 'fs'
import Store from 'electron-store'
import { getJanExtensionsPath } from '@janhq/core/node'

/**
 * Migrates the extensions by deleting the `extensions` directory in the user data path.
 * If the `migrated_version` key in the `Store` object does not match the current app version,
 * the function deletes the `extensions` directory and sets the `migrated_version` key to the current app version.
 * @returns A Promise that resolves when the migration is complete.
 */
export function migrateExtensions() {
  return new Promise((resolve) => {
    const store = new Store()
    if (store.get('migrated_version') !== app.getVersion()) {
      console.debug('start migration:', store.get('migrated_version'))

      rmdir(getJanExtensionsPath(), { recursive: true }, function (err) {
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
