import fs from 'fs'
import util from 'util'
import { getAppLogPath, getServerLogPath } from './config'

export const log = (message: string) => {
  const path = getAppLogPath()
  if (!message.startsWith('[')) {
    message = `[APP]::${message}`
  }

  message = `${new Date().toISOString()} ${message}`

  writeLog(message, path)
}

export const logServer = (message: string) => {
  const path = getServerLogPath()
  if (!message.startsWith('[')) {
    message = `[SERVER]::${message}`
  }

  message = `${new Date().toISOString()} ${message}`
  writeLog(message, path)
}

const writeLog = (message: string, logPath: string) => {
  if (!fs.existsSync(logPath)) {
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
