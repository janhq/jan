import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readdir,
  stat,
  unlink,
  writeFileSync,
} from 'fs'
import util from 'util'
import {
  getAppConfigurations,
  getJanDataFolderPath,
  Logger,
  LoggerManager,
} from '@janhq/core/node'
import path, { join } from 'path'

/**
 * File Logger
 */
export class FileLogger implements Logger {
  name = 'file'
  logCleaningInterval: number = 120000
  timeout: NodeJS.Timeout | undefined
  appLogPath: string = './'
  logEnabled: boolean = true

  constructor(
    logEnabled: boolean = true,
    logCleaningInterval: number = 120000
  ) {
    this.logEnabled = logEnabled
    if (logCleaningInterval) this.logCleaningInterval = logCleaningInterval

    const appConfigurations = getAppConfigurations()
    const logFolderPath = join(appConfigurations.data_folder, 'logs')
    if (!existsSync(logFolderPath)) {
      mkdirSync(logFolderPath, { recursive: true })
    }

    this.appLogPath = join(logFolderPath, 'app.log')
  }

  log(args: any) {
    if (!this.logEnabled) return
    let message = args[0]
    const scope = args[1]
    if (!message) return
    const path = this.appLogPath
    if (!scope && !message.startsWith('[')) {
      message = `[APP]::${message}`
    } else if (scope) {
      message = `${scope}::${message}`
    }

    message = `${new Date().toISOString()} ${message}`

    writeLog(message, path)
  }

  cleanLogs(
    maxFileSizeBytes?: number | undefined,
    daysToKeep?: number | undefined
  ): void {
    // clear existing timeout
    // in case we rerun it with different values
    if (this.timeout) clearTimeout(this.timeout)
    this.timeout = undefined

    if (!this.logEnabled) return

    console.log(
      'Validating app logs. Next attempt in ',
      this.logCleaningInterval
    )

    const size = maxFileSizeBytes ?? 1 * 1024 * 1024 // 1 MB
    const days = daysToKeep ?? 7 // 7 days
    const logDirectory = path.join(getJanDataFolderPath(), 'logs')
    // Perform log cleaning
    const currentDate = new Date()
    if (existsSync(logDirectory))
      readdir(logDirectory, (err, files) => {
        if (err) {
          console.error('Error reading log directory:', err)
          return
        }

        files.forEach((file) => {
          const filePath = path.join(logDirectory, file)
          stat(filePath, (err, stats) => {
            if (err) {
              console.error('Error getting file stats:', err)
              return
            }

            // Check size
            if (stats.size > size) {
              unlink(filePath, (err) => {
                if (err) {
                  console.error('Error deleting log file:', err)
                  return
                }
                console.debug(
                  `Deleted log file due to exceeding size limit: ${filePath}`
                )
              })
            } else {
              // Check age
              const creationDate = new Date(stats.ctime)
              const daysDifference = Math.floor(
                (currentDate.getTime() - creationDate.getTime()) /
                  (1000 * 3600 * 24)
              )
              if (daysDifference > days) {
                unlink(filePath, (err) => {
                  if (err) {
                    console.error('Error deleting log file:', err)
                    return
                  }
                  console.debug(`Deleted old log file: ${filePath}`)
                })
              }
            }
          })
        })
      })

    // Schedule the next execution with doubled delays
    this.timeout = setTimeout(
      () => this.cleanLogs(maxFileSizeBytes, daysToKeep),
      this.logCleaningInterval
    )
  }
}

/**
 * Write log function implementation
 * @param message
 * @param logPath
 */
const writeLog = (message: string, logPath: string) => {
  if (!existsSync(logPath)) {
    const logDirectory = path.join(getJanDataFolderPath(), 'logs')
    if (!existsSync(logDirectory)) {
      mkdirSync(logDirectory)
    }
    writeFileSync(logPath, message)
  } else {
    const logFile = createWriteStream(logPath, {
      flags: 'a',
    })
    logFile.write(util.format(message) + '\n')
    logFile.close()
    console.debug(message)
  }
}

/**
 * Register logger for global application logging
 */
export const registerLogger = () => {
  const logger = new FileLogger()
  LoggerManager.instance().register(logger)
  logger.cleanLogs()
}
