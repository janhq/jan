import fs from 'fs'
import util from 'util'
import path from 'path'
import os from 'os'

const appDir = path.join(os.homedir(), 'jan')

export const logPath = path.join(appDir, 'app.log')

export const log = function (d: any) {
  if (fs.existsSync(appDir)) {
    var log_file = fs.createWriteStream(logPath, {
      flags: 'a',
    })
    log_file.write(util.format(d) + '\n')
    log_file.close()
  }
}
