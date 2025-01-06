import { SystemResourceInfo } from '../../types'

export const getSystemResourceInfo = async (): Promise<SystemResourceInfo> => {
  return {
    numCpuPhysicalCore: 0,
    memAvailable: 0, // TODO: this should not be 0
  }
}
