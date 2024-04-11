import { GpuSetting, OperatingSystemInfo } from '../miscellaneous'

/**
 * Monitoring extension for system monitoring.
 * @extends BaseExtension
 */
export interface MonitoringInterface {
  /**
   * Returns information about the system resources.
   * @returns {Promise<any>} A promise that resolves with the system resources information.
   */
  getResourcesInfo(): Promise<any>

  /**
   * Returns the current system load.
   * @returns {Promise<any>} A promise that resolves with the current system load.
   */
  getCurrentLoad(): Promise<any>

  /**
   * Returns the GPU configuration.
   */
  getGpuSetting(): Promise<GpuSetting | undefined>

  /**
   * Returns information about the operating system.
   */
  getOsInfo(): Promise<OperatingSystemInfo>
}
