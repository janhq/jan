import { PluginType } from "@janhq/core";
import { MonitoringPlugin } from "@janhq/core/lib/plugins";
import { executeOnMain } from "@janhq/core";

/**
 * JanMonitoringPlugin is a plugin that provides system monitoring functionality.
 * It implements the MonitoringPlugin interface from the @janhq/core package.
 */
export default class JanMonitoringPlugin implements MonitoringPlugin {
  /**
   * Returns the type of the plugin.
   * @returns The PluginType.SystemMonitoring value.
   */
  type(): PluginType {
    return PluginType.SystemMonitoring;
  }

  /**
   * Called when the plugin is loaded.
   */
  onLoad(): void {}

  /**
   * Called when the plugin is unloaded.
   */
  onUnload(): void {}

  /**
   * Returns information about the system resources.
   * @returns A Promise that resolves to an object containing information about the system resources.
   */
  getResourcesInfo(): Promise<any> {
    return executeOnMain(MODULE, "getResourcesInfo");
  }

  /**
   * Returns information about the current system load.
   * @returns A Promise that resolves to an object containing information about the current system load.
   */
  getCurrentLoad(): Promise<any> {
    return executeOnMain(MODULE, "getCurrentLoad");
  }
}
