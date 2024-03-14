import { BaseExtension, ExtensionTypeEnum } from '../extension'
import { GpuSetting, MonitoringInterface } from '../index'

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

  abstract getGpuSetting(): Promise<GpuSetting>
  abstract getResourcesInfo(): Promise<any>
  abstract getCurrentLoad(): Promise<any>
}
