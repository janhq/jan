import { AppConfiguration, fs } from '@janhq/core'
import { invoke } from '@tauri-apps/api/core'

/**
 * @description This function is used to reset the app to its factory settings.
 * It will remove all the data from the app, including the data folder and local storage.
 * @returns {Promise<void>}
 */
export const factoryReset = async () => {
  const appConfiguration: AppConfiguration | undefined =
    await window.core?.api?.getAppConfigurations()

  const janDataFolderPath = appConfiguration?.data_folder
  if (janDataFolderPath) await fs.rm(janDataFolderPath)
  window.localStorage.clear()
  await window.core?.api?.installExtensions()
  await window.core?.api?.relaunch()
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

  if (!match) return undefined // Skip invalid lines

  const [, date, time, target, levelRaw, message] = match

  const level = levelRaw.toLowerCase() as 'info' | 'warn' | 'error' | 'debug'

  return {
    timestamp: `${date} ${time}`,
    level,
    target,
    message,
  }
}
