import { log } from '@janhq/core/node'
import { app } from 'electron'
import os from 'os'

export const logSystemInfo = (): void => {
  log(`[SPECS]::Version: ${app.getVersion()}`)
  log(`[SPECS]::CPUs: ${JSON.stringify(os.cpus())}`)
  log(`[SPECS]::Machine: ${os.machine()}`)
  log(`[SPECS]::Endianness: ${os.endianness()}`)
  log(`[SPECS]::Parallelism: ${os.availableParallelism()}`)
  log(`[SPECS]::Free Mem: ${os.freemem()}`)
  log(`[SPECS]::Total Mem: ${os.totalmem()}`)
  log(`[SPECS]::OS Version: ${os.version()}`)
  log(`[SPECS]::OS Platform: ${os.platform()}`)
  log(`[SPECS]::OS Release: ${os.release()}`)
}
