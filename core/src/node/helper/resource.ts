import { SystemResourceInfo } from '../../types'
import { physicalCpuCount } from './config'
import { log } from './logger'

export const getSystemResourceInfo = async (): Promise<SystemResourceInfo> => {
  const cpu = await physicalCpuCount()
  log(`[CORTEX]::CPU information - ${cpu}`)

  return {
    numCpuPhysicalCore: cpu,
    memAvailable: 0, // TODO: this should not be 0
  }
}
