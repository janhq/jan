/**
 * Monitoring extension for system monitoring.
 * @extends BaseExtension
 */
export interface MonitoringInterface {
  /**
   * Returns the current system load.
   * @returns {Promise<any>} A promise that resolves with the current system load.
   */
  getCurrentLoad(): Promise<any>
}
