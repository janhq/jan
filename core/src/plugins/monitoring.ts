import { JanPlugin } from "../plugin";

/**
 * Abstract class for monitoring plugins.
 * @extends JanPlugin
 */
export abstract class MonitoringPlugin extends JanPlugin {
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
