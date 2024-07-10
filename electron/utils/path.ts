import { mkdir } from 'fs-extra'
import { existsSync, writeFileSync, readFileSync } from 'fs'
import { join } from 'path'
import { AppConfiguration } from '@janhq/core/node'
import os from 'os'


const configurationFileName = 'settings.json'

const defaultJanDataFolder = join(os.homedir(), 'jan')

const defaultAppConfig: AppConfiguration = {
  data_folder: defaultJanDataFolder,
  quick_ask: false,
}

export async function createUserSpace(): Promise<void> {
  const janDataFolderPath = getJanDataFolderPath()
  if (!existsSync(janDataFolderPath)) {
    try {
      await mkdir(janDataFolderPath)
    } catch (err) {
      console.error(
        `Unable to create Jan data folder at ${janDataFolderPath}: ${err}`
      )
    }
  }
}

export async function appResourcePath(): Promise<string> {
  let electron: any = undefined

  try {
    const moduleName = 'electron'
    electron = await import(moduleName)
  } catch (err) {
    console.error('Electron is not available')
  }

  // electron
  if (electron && electron.protocol) {
    let appPath = join(electron.app.getAppPath(), '..', 'app.asar.unpacked')

    if (!electron.app.isPackaged) {
      // for development mode
      appPath = join(electron.app.getAppPath())
    }
    return appPath
  }
  // server
  return join(global.core.appPath(), '../../..')
}

/**
 * Getting App Configurations.
 *
 * @returns {AppConfiguration} The app configurations.
 */
export const getAppConfigurations = (): AppConfiguration => {
  // Retrieve Application Support folder path
  // Fallback to user home directory if not found
  const configurationFile = getConfigurationFilePath()

  if (!existsSync(configurationFile)) {
    // create default app config if we don't have one
    console.debug(
      `App config not found, creating default config at ${configurationFile}`
    )
    writeFileSync(configurationFile, JSON.stringify(defaultAppConfig))
    return defaultAppConfig
  }

  try {
    const appConfigurations: AppConfiguration = JSON.parse(
      readFileSync(configurationFile, 'utf-8')
    )
    return appConfigurations
  } catch (err) {
    console.error(
      `Failed to read app config, return default config instead! Err: ${err}`
    )
    return defaultAppConfig
  }
}

const getConfigurationFilePath = () =>
  join(
    global.core?.appPath() ||
    process.env[process.platform == 'win32' ? 'USERPROFILE' : 'HOME'],
    configurationFileName
  )

export const updateAppConfiguration = (
  configuration: AppConfiguration
): Promise<void> => {
  const configurationFile = getConfigurationFilePath()
  console.debug(
    'updateAppConfiguration, configurationFile: ',
    configurationFile
  )

  writeFileSync(configurationFile, JSON.stringify(configuration))
  return Promise.resolve()
}

/**
 * Utility function to get data folder path
 *
 * @returns {string} The data folder path.
 */
export const getJanDataFolderPath = (): string => {
  const appConfigurations = getAppConfigurations()
  return appConfigurations.data_folder
}
