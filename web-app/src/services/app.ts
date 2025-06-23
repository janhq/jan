import { AppConfiguration, fs } from '@janhq/core'
import { invoke } from '@tauri-apps/api/core'
import { emit } from '@tauri-apps/api/event'
import { stopAllModels } from './models'
import { SystemEvent } from '@/types/events'

/**
 * @description This function is used to reset the app to its factory settings.
 * It will remove all the data from the app, including the data folder and local storage.
 * @param skipValidation Whether to skip validation checks (default: false)
 * @returns {Promise<void>}
 */
export const factoryReset = async (skipValidation: boolean = false) => {
  // Validate before proceeding if validation is not skipped
  if (!skipValidation) {
    const { validateFactoryResetFolder } = await import('./validation')
    const validation = await validateFactoryResetFolder()
    
    if (validation.error_message) {
      throw new Error(`Factory reset validation failed: ${validation.error_message}`)
    }
    
    // Log warnings but don't block the operation
    if (validation.warnings.length > 0) {
      console.warn('Factory reset warnings:', validation.warnings)
    }
  }

  // Kill background processes and remove data folder
  await stopAllModels()
  emit(SystemEvent.KILL_SIDECAR)
  setTimeout(async () => {
    const janDataFolderPath = await getJanDataFolder()
    if (janDataFolderPath) await fs.rm(janDataFolderPath)
    window.localStorage.clear()
    await window.core?.api?.installExtensions()
    await window.core?.api?.relaunch()
  }, 1000)
}

/**
 * @description This function is used to read the logs from the app.
 * It will return the logs as a string.
 * @returns
 */
export const readLogs = async () => {
  const logData: string = (await invoke('read_logs')) ?? ''
  return logData.split('\n').map(parseLogLine)
}

/**
 * @description This function is used to parse a log line.
 * It will return the log line as an object.
 * @param line
 * @returns
 */
export const parseLogLine = (line: string) => {
  const regex = /^\[(.*?)\]\[(.*?)\]\[(.*?)\]\[(.*?)\]\s(.*)$/
  const match = line.match(regex)

  if (!match)
    return {
      timestamp: Date.now(),
      level: 'info' as 'info' | 'warn' | 'error' | 'debug',
      target: 'info',
      message: line ?? '',
    } as LogEntry

  const [, date, time, target, levelRaw, message] = match

  const level = levelRaw.toLowerCase() as 'info' | 'warn' | 'error' | 'debug'

  return {
    timestamp: `${date} ${time}`,
    level,
    target,
    message,
  }
}

/**
 * @description This function is used to get the Jan data folder path.
 * It retrieves the path from the app configuration.
 * @returns {Promise<string | undefined>} The Jan data folder path or undefined if not found
 */
export const getJanDataFolder = async (): Promise<string | undefined> => {
  try {
    const appConfiguration: AppConfiguration | undefined =
      await window.core?.api?.getAppConfigurations()

    return appConfiguration?.data_folder
  } catch (error) {
    console.error('Failed to get Jan data folder:', error)
    return undefined
  }
}

/**
 * @description This function is used to relocate the Jan data folder.
 * It will change the app data folder to the specified path.
 * @param path The new path for the Jan data folder
 */
export const relocateJanDataFolder = async (path: string) => {
  await window.core?.api?.changeAppDataFolder({ newDataFolder: path })
}
