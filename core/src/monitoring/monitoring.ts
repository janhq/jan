import { BaseExtension } from "../extension";

/**
 * Monitoring extension for system monitoring.
 * @extends BaseExtension
 */
export abstract class MonitoringExtension extends BaseExtension {
  /**
   * Returns information about the system resources.
   * @returns {Promise<any>} A promise that resolves with the system resources information.
   */
  abstract getResourcesInfo(): Promise<any>;

  /**
   * Returns the current system load.
   * @returns {Promise<any>} A promise that resolves with the current system load.
   */
  abstract getCurrentLoad(): Promise<any>;
}
