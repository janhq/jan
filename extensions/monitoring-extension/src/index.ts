import { BaseExtension, ExtensionType } from "@janhq/core";
import { MonitoringInterface } from "@janhq/core";
import { executeOnMain } from "@janhq/core";

/**
 * JanMonitoringExtension is a extension that provides system monitoring functionality.
 * It implements the MonitoringExtension interface from the @janhq/core package.
 */
export default class JanMonitoringExtension
  extends BaseExtension
  implements MonitoringInterface
{
  /**
   * Returns the type of the extension.
   * @returns The ExtensionType.SystemMonitoring value.
   */
  type(): ExtensionType {
    return ExtensionType.SystemMonitoring;
  }

  /**
   * Called when the extension is loaded.
   */
  onLoad(): void {}

  /**
   * Called when the extension is unloaded.
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
