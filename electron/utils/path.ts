import { mkdir } from 'fs-extra'
import { existsSync, writeFileSync, readFileSync } from 'fs'
import { join } from 'path'
import { AppConfiguration } from '@janhq/core/node'
import os from 'os'
import { dump, load } from 'js-yaml'

const configurationFileName = '.janrc'

const defaultJanDataFolder = join(os.homedir(), 'jan')

const defaultAppConfig: AppConfiguration = {
  dataFolderPath: defaultJanDataFolder,
  quickAsk: true,
  cortexCppHost: '127.0.0.1',
  cortexCppPort: 3940,
  apiServerHost: '127.0.0.1',
  apiServerPort: 1338
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
  console.debug('getAppConfiguration file path', configurationFile)

  if (!existsSync(configurationFile)) {
    // create default app config if we don't have one
    console.debug(
      `App config not found, creating default config at ${configurationFile}`
    )
    writeFileSync(configurationFile, dump(defaultAppConfig))
    return defaultAppConfig
  }

  try {
    const configYaml = readFileSync(configurationFile, 'utf-8')
    const appConfigurations = load(configYaml) as AppConfiguration
    console.debug('app config', appConfigurations)
    return appConfigurations
  } catch (err) {
    console.error(
      `Failed to read app config, return default config instead! Err: ${err}`
    )
    return defaultAppConfig
  }
}

// Get configuration file path of the application
const getConfigurationFilePath = () => {
  const homeDir = os.homedir();
  const configPath = join(
    homeDir,
    configurationFileName,
  );
  return configPath
}

export const updateAppConfiguration = (
  configuration: AppConfiguration
): Promise<void> => {
  const configurationFile = getConfigurationFilePath()
  console.debug(
    'updateAppConfiguration, configurationFile: ',
    configurationFile
  )

  writeFileSync(configurationFile, dump(configuration))
  return Promise.resolve()
}

/**
 * Utility function to get data folder path
 *
 * @returns {string} The data folder path.
 */
export const getJanDataFolderPath = (): string => {
  return getAppConfigurations().dataFolderPath 
}

// This is to support pulling legacy configs for migration purpose
export const legacyConfigs = () => {
  const legacyConfigFilePath = join(
    process.env[process.platform == 'win32' ? 'USERPROFILE' : 'HOME'] ?? '',
    'settings.json'
  )
  const legacyConfigs = JSON.parse(readFileSync(legacyConfigFilePath, 'utf-8')) as any

  return legacyConfigs
}

// This is to support pulling legacy data path for migration purpose
export const legacyDataPath = () => {
  return legacyConfigs().data_path
}
