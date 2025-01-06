import { SystemResourceInfo } from '../../types'

export const getSystemResourceInfo = async (): Promise<SystemResourceInfo> => {
  return {
    memAvailable: 0, // TODO: this should not be 0
  }
}
