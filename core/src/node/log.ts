import fs from 'fs'
import util from 'util'
import path from 'path'
import os from 'os'

export const logPath = path.join(os.homedir(), 'jan', 'app.log')

var log_file = fs.createWriteStream(logPath, {
  flags: 'a',
})

export const log = function (d: any) {
  log_file.write(util.format(d) + '\n')
}
