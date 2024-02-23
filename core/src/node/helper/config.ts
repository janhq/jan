import { AppConfiguration } from '../../types'
import { join } from 'path'
import fs from 'fs'
import os from 'os'
import childProcess from 'child_process'

// TODO: move this to core
const configurationFileName = 'settings.json'

// TODO: do no specify app name in framework module
const defaultJanDataFolder = join(os.homedir(), 'jan')
const defaultAppConfig: AppConfiguration = {
  data_folder: defaultJanDataFolder,
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

  if (!fs.existsSync(configurationFile)) {
    // create default app config if we don't have one
    console.debug(`App config not found, creating default config at ${configurationFile}`)
    fs.writeFileSync(configurationFile, JSON.stringify(defaultAppConfig))
    return defaultAppConfig
  }

  try {
    const appConfigurations: AppConfiguration = JSON.parse(
      fs.readFileSync(configurationFile, 'utf-8')
    )
    return appConfigurations
  } catch (err) {
    console.error(`Failed to read app config, return default config instead! Err: ${err}`)
    return defaultAppConfig
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

export const getEngineConfiguration = async (engineId: string) => {
  if (engineId !== 'openai') {
    return undefined
  }
  const directoryPath = join(getJanDataFolderPath(), 'engines')
  const filePath = join(directoryPath, `${engineId}.json`)
  const data = fs.readFileSync(filePath, 'utf-8')
  return JSON.parse(data)
}

/**
 * Utility function to get server log path
 *
 * @returns {string} The log path.
 */
export const getServerLogPath = (): string => {
  const appConfigurations = getAppConfigurations()
  const logFolderPath = join(appConfigurations.data_folder, 'logs')
  if (!fs.existsSync(logFolderPath)) {
    fs.mkdirSync(logFolderPath, { recursive: true })
  }
  return join(logFolderPath, 'server.log')
}

/**
 * Utility function to get app log path
 *
 * @returns {string} The log path.
 */
export const getAppLogPath = (): string => {
  const appConfigurations = getAppConfigurations()
  const logFolderPath = join(appConfigurations.data_folder, 'logs')
  if (!fs.existsSync(logFolderPath)) {
    fs.mkdirSync(logFolderPath, { recursive: true })
  }
  return join(logFolderPath, 'app.log')
}
