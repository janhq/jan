import { AppConfiguration, SettingComponentProps } from '../../types'
import { join, resolve } from 'path'
import fs from 'fs'
import os from 'os'
import childProcess from 'child_process'
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
    console.debug(`App config not found, creating default config at ${configurationFile}`)
    fs.writeFileSync(configurationFile, JSON.stringify(appDefaultConfiguration))
    return appDefaultConfiguration
  }

  try {
    const appConfigurations: AppConfiguration = JSON.parse(
      fs.readFileSync(configurationFile, 'utf-8')
    )
    return appConfigurations
  } catch (err) {
    console.error(`Failed to read app config, return default config instead! Err: ${err}`)
    return defaultAppConfig()
  }
}

const getConfigurationFilePath = () =>
  join(
    global.core?.appPath() || process.env[process.platform == 'win32' ? 'USERPROFILE' : 'HOME'],
    configurationFileName
  )

export const updateAppConfiguration = (configuration: AppConfiguration): Promise<void> => {
  const configurationFile = getConfigurationFilePath()
  console.debug('updateAppConfiguration, configurationFile: ', configurationFile)

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
 * Utility function to physical cpu count
 *
 * @returns {number} The physical cpu count.
 */
export const physicalCpuCount = async (): Promise<number> => {
  const platform = os.platform()
  try {
    if (platform === 'linux') {
      const output = await exec('lscpu -p | egrep -v "^#" | sort -u -t, -k 2,4 | wc -l')
      return parseInt(output.trim(), 10)
    } else if (platform === 'darwin') {
      const output = await exec('sysctl -n hw.physicalcpu_max')
      return parseInt(output.trim(), 10)
    } else if (platform === 'win32') {
      const output = await exec('WMIC CPU Get NumberOfCores')
      return output
        .split(os.EOL)
        .map((line: string) => parseInt(line))
        .filter((value: number) => !isNaN(value))
        .reduce((sum: number, number: number) => sum + number, 1)
    } else {
      const cores = os.cpus().filter((cpu: any, index: number) => {
        const hasHyperthreading = cpu.model.includes('Intel')
        const isOdd = index % 2 === 1
        return !hasHyperthreading || isOdd
      })
      return cores.length
    }
  } catch (err) {
    console.warn('Failed to get physical CPU count', err)
    // Divide by 2 to get rid of hyper threading
    const coreCount = Math.ceil(os.cpus().length / 2)
    console.debug('Using node API to get physical CPU count:', coreCount)
    return coreCount
  }
}

const exec = async (command: string): Promise<string> => {
  return new Promise((resolve, reject) => {
    childProcess.exec(command, { encoding: 'utf8' }, (error, stdout) => {
      if (error) {
        reject(error)
      } else {
        resolve(stdout)
      }
    })
  })
}

// a hacky way to get the api key. we should comes up with a better
// way to handle this
export const getEngineConfiguration = async (engineId: string) => {
  if (engineId !== 'openai' && engineId !== 'groq') return undefined

  const settingDirectoryPath = join(
    getJanDataFolderPath(),
    'settings',
    '@janhq',
    engineId === 'openai' ? 'inference-openai-extension' : 'inference-groq-extension',
    'settings.json'
  )

  const content = fs.readFileSync(settingDirectoryPath, 'utf-8')
  const settings: SettingComponentProps[] = JSON.parse(content)
  const apiKeyId = engineId === 'openai' ? 'openai-api-key' : 'groq-api-key'
  const keySetting = settings.find((setting) => setting.key === apiKeyId)
  let fullUrl = settings.find((setting) => setting.key === 'chat-completions-endpoint')
    ?.controllerProps.value

  let apiKey = keySetting?.controllerProps.value
  if (typeof apiKey !== 'string') apiKey = ''
  if (typeof fullUrl !== 'string') fullUrl = ''

  return {
    api_key: apiKey,
    full_url: fullUrl,
  }
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
  const defaultJanDataFolder = join(app?.getPath('userData') ?? os?.homedir() ?? '', 'data')
  return {
    data_folder:
      process.env.CI === 'e2e'
        ? (process.env.APP_CONFIG_PATH ?? resolve('./test-data'))
        : defaultJanDataFolder,
    quick_ask: false,
  }
}
