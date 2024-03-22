import {
  GpuSetting,
  MonitoringExtension,
  OperatingSystemInfo,
  executeOnMain,
} from '@janhq/core'

/**
 * JanMonitoringExtension is a extension that provides system monitoring functionality.
 * It implements the MonitoringExtension interface from the @janhq/core package.
 */
export default class JanMonitoringExtension extends MonitoringExtension {
  /**
   * Called when the extension is loaded.
   */
  async onLoad() {
    // Attempt to fetch nvidia info
    await executeOnMain(NODE, 'updateNvidiaInfo')
  }

  /**
   * Called when the extension is unloaded.
   */
  onUnload(): void {}

  /**
   * Returns the GPU configuration.
   * @returns A Promise that resolves to an object containing the GPU configuration.
   */
  async getGpuSetting(): Promise<GpuSetting | undefined> {
    return executeOnMain(NODE, 'getGpuConfig')
  }

  /**
   * Returns information about the system resources.
   * @returns A Promise that resolves to an object containing information about the system resources.
   */
  getResourcesInfo(): Promise<any> {
    return executeOnMain(NODE, 'getResourcesInfo')
  }

  /**
   * Returns information about the current system load.
   * @returns A Promise that resolves to an object containing information about the current system load.
   */
  getCurrentLoad(): Promise<any> {
    return executeOnMain(NODE, 'getCurrentLoad')
  }

  getOsInfo(): Promise<OperatingSystemInfo> {
    return executeOnMain(NODE, 'getOsInfo')
  }
}
