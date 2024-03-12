import { GpuSetting, MonitoringExtension, executeOnMain } from '@janhq/core'

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
    return {
      notify: true,
      run_mode: 'cpu',
      nvidia_driver: {
        exist: false,
        version: '',
      },
      cuda: {
        exist: false,
        version: '',
      },
      gpus: [],
      gpu_highest_vram: '',
      gpus_in_use: [],
      is_initial: true,
      // TODO: This needs to be set based on user toggle in settings
      vulkan: false,
    }
    // try {
    //   const result = await executeOnMain(NODE, 'getGpuConfig')
    //   return result
    // } catch (error) {
    //   // TODO: remove this. for testing on mac only
    //   return {
    //     notify: true,
    //     run_mode: 'cpu',
    //     nvidia_driver: {
    //       exist: false,
    //       version: '',
    //     },
    //     cuda: {
    //       exist: false,
    //       version: '',
    //     },
    //     gpus: [],
    //     gpu_highest_vram: '',
    //     gpus_in_use: [],
    //     is_initial: true,
    //     // TODO: This needs to be set based on user toggle in settings
    //     vulkan: false,
    //   }
    // }
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
}
