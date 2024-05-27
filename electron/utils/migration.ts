import { app } from 'electron'

import { join } from 'path'
import { rmdirSync, cpSync, existsSync } from 'fs'
import Store from 'electron-store'
import {
  getJanExtensionsPath,
  getJanDataFolderPath,
  appResourcePath,
} from '@janhq/core/node'

/**
 * Migrates the extensions & themes.
 * If the `migrated_version` key in the `Store` object does not match the current app version,
 * the function deletes the `extensions` directory and sets the `migrated_version` key to the current app version.
 * @returns A Promise that resolves when the migration is complete.
 */
export async function migrate() {
  const store = new Store()
  if (store.get('migrated_version') !== app.getVersion()) {
    console.debug('start migration:', store.get('migrated_version'))

    if (existsSync(getJanExtensionsPath()))
      rmdirSync(getJanExtensionsPath(), { recursive: true })
    await migrateThemes()

    store.set('migrated_version', app.getVersion())
    console.debug('migrate extensions done')
  } else if (!existsSync(join(getJanDataFolderPath(), 'themes'))) {
    await migrateThemes()
  }
}

async function migrateThemes() {
  if (existsSync(join(getJanDataFolderPath(), 'themes')))
    rmdirSync(join(getJanDataFolderPath(), 'themes'), { recursive: true })
  cpSync(
    join(await appResourcePath(), 'themes'),
    join(getJanDataFolderPath(), 'themes'),
    { recursive: true }
  )
}
