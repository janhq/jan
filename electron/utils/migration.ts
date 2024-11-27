import { app } from 'electron'

import { join } from 'path'
import {
  rmdirSync,
  existsSync,
  mkdirSync,
  readdirSync,
  cpSync,
  lstatSync,
} from 'fs'
import Store from 'electron-store'
import {
  getJanDataFolderPath,
  appResourcePath,
  getJanExtensionsPath,
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
  if (!existsSync(join(getJanDataFolderPath(), 'themes')))
    mkdirSync(join(getJanDataFolderPath(), 'themes'), { recursive: true })

  const themes = readdirSync(join(appResourcePath(), 'themes'))
  for (const theme of themes) {
    const themePath = join(appResourcePath(), 'themes', theme)
    await checkAndMigrateTheme(theme, themePath)
  }
}

async function checkAndMigrateTheme(
  sourceThemeName: string,
  sourceThemePath: string
) {
  const janDataThemesFolder = join(getJanDataFolderPath(), 'themes')
  const existingTheme = readdirSync(janDataThemesFolder).find(
    (theme) => theme === sourceThemeName
  )
  if (existingTheme) {
    const desTheme = join(janDataThemesFolder, existingTheme)
    if (!lstatSync(desTheme).isDirectory()) {
      return
    }
    console.debug('Updating theme', existingTheme)
    rmdirSync(desTheme, { recursive: true })
    cpSync(sourceThemePath, join(janDataThemesFolder, sourceThemeName), {
      recursive: true,
    })
  } else {
    console.debug('Adding new theme', sourceThemeName)
    cpSync(sourceThemePath, join(janDataThemesFolder, sourceThemeName), {
      recursive: true,
    })
  }
}
