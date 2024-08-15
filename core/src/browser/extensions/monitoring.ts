import { BaseExtension, ExtensionTypeEnum } from '../extension'
import { GpuSetting, MonitoringInterface, OperatingSystemInfo } from '../../types'

/**
 * Monitoring extension for system monitoring.
 * @extends BaseExtension
 */
export abstract class MonitoringExtension extends BaseExtension implements MonitoringInterface {
  /**
   * Monitoring extension type.
   */
  type(): ExtensionTypeEnum | undefined {
    return ExtensionTypeEnum.SystemMonitoring
  }

  abstract getGpuSetting(): Promise<GpuSetting | undefined>
  abstract getResourcesInfo(): Promise<any>
  abstract getCurrentLoad(): Promise<any>
  abstract getOsInfo(): Promise<OperatingSystemInfo>
}
