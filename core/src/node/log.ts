import fs from 'fs'
import util from 'util'
import { getAppLogPath, getServerLogPath } from './utils'

export const log = function (message: string) {
  const appLogPath = getAppLogPath()
  if (!message.startsWith('[')) {
    message = `[APP]::${message}`
  }

  message = `${new Date().toISOString()} ${message}`

  if (fs.existsSync(appLogPath)) {
    var log_file = fs.createWriteStream(appLogPath, {
      flags: 'a',
    })
    log_file.write(util.format(message) + '\n')
    log_file.close()
    console.debug(message)
  }
}

export const logServer = function (message: string) {
  const serverLogPath = getServerLogPath()
  if (!message.startsWith('[')) {
    message = `[APP]::${message}`
  }

  message = `${new Date().toISOString()} ${message}`

  if (fs.existsSync(serverLogPath)) {
    var log_file = fs.createWriteStream(serverLogPath, {
      flags: 'a',
    })
    log_file.write(util.format(message) + '\n')
    log_file.close()
    console.debug(message)
  }
}
