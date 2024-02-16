import { SystemResourceInfo } from '../../types'
import { physicalCpuCount } from './config'
import { log, logServer } from './log'

export const getSystemResourceInfo = async (): Promise<SystemResourceInfo> => {
  const cpu = await physicalCpuCount()
  const message = `[NITRO]::CPU informations - ${cpu}`
  log(message)

  return {
    numCpuPhysicalCore: cpu,
    memAvailable: 0, // TODO: this should not be 0
  }
}
