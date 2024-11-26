import {
  AppConfigurationEventName,
  GpuSetting,
  MonitoringExtension,
  OperatingSystemInfo,
  events,
  executeOnMain,
} from '@janhq/core'

declare const SETTINGS: Array<any>

enum Settings {
  logEnabled = 'log-enabled',
  logCleaningInterval = 'log-cleaning-interval',
}
/**
 * JanMonitoringExtension is a extension that provides system monitoring functionality.
 * It implements the MonitoringExtension interface from the @janhq/core package.
 */
export default class JanMonitoringExtension extends MonitoringExtension {
  /**
   * Called when the extension is loaded.
   */
  async onLoad() {
    // Register extension settings
    this.registerSettings(SETTINGS)

    const logEnabled = await this.getSetting<boolean>(Settings.logEnabled, true)
    const logCleaningInterval = parseInt(
      await this.getSetting<string>(Settings.logCleaningInterval, '120000')
    )
    // Register File Logger provided by this extension
    await executeOnMain(NODE, 'registerLogger', {
      logEnabled,
      logCleaningInterval: isNaN(logCleaningInterval)
        ? 120000
        : logCleaningInterval,
    })

    // Attempt to fetch nvidia info
    await executeOnMain(NODE, 'updateNvidiaInfo')
    events.emit(AppConfigurationEventName.OnConfigurationUpdate, {})
  }

  onSettingUpdate<T>(key: string, value: T): void {
    if (key === Settings.logEnabled) {
      executeOnMain(NODE, 'updateLogger', { logEnabled: value })
    } else if (key === Settings.logCleaningInterval) {
      executeOnMain(NODE, 'updateLogger', { logCleaningInterval: value })
    }
  }

  /**
   * Called when the extension is unloaded.
   */
  onUnload(): void {
    // Register File Logger provided by this extension
    executeOnMain(NODE, 'unregisterLogger')
  }

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

  /**
   * Returns information about the OS
   * @returns
   */
  getOsInfo(): Promise<OperatingSystemInfo> {
    return executeOnMain(NODE, 'getOsInfo')
  }
}
