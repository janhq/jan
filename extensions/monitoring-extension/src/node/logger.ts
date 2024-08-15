import fs from 'fs'
import util from 'util'
import {
  getAppConfigurations,
  getJanDataFolderPath,
  Logger,
} from '@janhq/core/node'
import path, { join } from 'path'

export class FileLogger extends Logger {
  name = 'file'
  logCleaningInterval: number = 120000
  timeout: NodeJS.Timeout | null = null
  appLogPath: string = './'
  logEnabled: boolean = true

  constructor(
    logEnabled: boolean = true,
    logCleaningInterval: number = 120000
  ) {
    super()
    this.logEnabled = logEnabled
    if (logCleaningInterval) this.logCleaningInterval = logCleaningInterval

    const appConfigurations = getAppConfigurations()
    const logFolderPath = join(appConfigurations.data_folder, 'logs')
    if (!fs.existsSync(logFolderPath)) {
      fs.mkdirSync(logFolderPath, { recursive: true })
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
    if (fs.existsSync(logDirectory))
      fs.readdir(logDirectory, (err, files) => {
        if (err) {
          console.error('Error reading log directory:', err)
          return
        }

        files.forEach((file) => {
          const filePath = path.join(logDirectory, file)
          fs.stat(filePath, (err, stats) => {
            if (err) {
              console.error('Error getting file stats:', err)
              return
            }

            // Check size
            if (stats.size > size) {
              fs.unlink(filePath, (err) => {
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
                fs.unlink(filePath, (err) => {
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

const writeLog = (message: string, logPath: string) => {
  if (!fs.existsSync(logPath)) {
    const logDirectory = path.join(getJanDataFolderPath(), 'logs')
    if (!fs.existsSync(logDirectory)) {
      fs.mkdirSync(logDirectory)
    }
    fs.writeFileSync(logPath, message)
  } else {
    const logFile = fs.createWriteStream(logPath, {
      flags: 'a',
    })
    logFile.write(util.format(message) + '\n')
    logFile.close()
    console.debug(message)
  }
}
