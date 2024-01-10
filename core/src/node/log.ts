import fs from 'fs'
import util from 'util'
import path from 'path'
import os from 'os'

export const logDir = path.join(os.homedir(), 'jan', 'logs')

export const log = function (message: string, fileName: string = 'app.log') {
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true })
  }
  if (!message.startsWith('[')) {
    message = `[APP]::${message}`
  }

  message = `${new Date().toISOString()} ${message}`

  if (fs.existsSync(logDir)) {
    var log_file = fs.createWriteStream(path.join(logDir, fileName), {
      flags: 'a',
    })
    log_file.write(util.format(message) + '\n')
    log_file.close()
    console.debug(message)
  }
}
