import { AppConfiguration } from '../../types'
import { join, resolve } from 'path'
import fs from 'fs'
import os from 'os'
const configurationFileName = 'settings.json'

/**
 * Getting App Configurations.
 *
 * @returns {AppConfiguration} The app configurations.
 */
export const getAppConfigurations = (): AppConfiguration => {
  const appDefaultConfiguration = defaultAppConfig()
  if (process.env.CI === 'e2e') return appDefaultConfiguration
  // Retrieve Application Support folder path
  // Fallback to user home directory if not found
  const configurationFile = getConfigurationFilePath()

  if (!fs.existsSync(configurationFile)) {
    // create default app config if we don't have one
    console.debug(
      `App config not found, creating default config at ${configurationFile}`
    )
    fs.writeFileSync(configurationFile, JSON.stringify(appDefaultConfiguration))
    return appDefaultConfiguration
  }

  try {
    const appConfigurations: AppConfiguration = JSON.parse(
      fs.readFileSync(configurationFile, 'utf-8')
    )
    return appConfigurations
  } catch (err) {
    console.error(
      `Failed to read app config, return default config instead! Err: ${err}`
    )
    return defaultAppConfig()
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

  fs.writeFileSync(configurationFile, JSON.stringify(configuration))
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

/**
 * Utility function to get extension path
 *
 * @returns {string} The extensions path.
 */
export const getJanExtensionsPath = (): string => {
  const appConfigurations = getAppConfigurations()
  return join(appConfigurations.data_folder, 'extensions')
}

/**
 * Default app configurations
 * App Data Folder default to Electron's userData
 * %APPDATA% on Windows
 * $XDG_CONFIG_HOME or ~/.config on Linux
 * ~/Library/Application Support on macOS
 */
export const defaultAppConfig = (): AppConfiguration => {
  const { app } = require('electron')
  const defaultJanDataFolder = join(
    app?.getPath('userData') ?? os?.homedir() ?? '',
    'data'
  )
  return {
    data_folder:
      process.env.CI === 'e2e'
        ? (process.env.APP_CONFIG_PATH ?? resolve('./test-data'))
        : defaultJanDataFolder,
    quick_ask: false,
  }
}
