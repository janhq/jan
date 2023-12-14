import { BaseExtension } from '../extension'
import { MonitoringInterface } from '../index'

/**
 * Monitoring extension for system monitoring.
 * @extends BaseExtension
 */
export abstract class MonitoringExtension extends BaseExtension implements MonitoringInterface {
  abstract getResourcesInfo(): Promise<any>
  abstract getCurrentLoad(): Promise<any>
}
