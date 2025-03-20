import { HardwareManagementExtension, HardwareInformation } from '@janhq/core'
import ky, { KyInstance } from 'ky'
import PQueue from 'p-queue'

/**
 * JSONHardwareManagementExtension is a HardwareManagementExtension implementation that provides
 * functionality for managing engines.
 */
export default class JSONHardwareManagementExtension extends HardwareManagementExtension {
  queue = new PQueue({ concurrency: 1 })

  /**
   * Extended API instance for making requests to the Cortex API.
   * @returns 
   */
  api: KyInstance
  /**
   * Called when the extension is loaded.
   */
  async onLoad() {
    const apiKey = await window.core?.api.appToken() ?? 'cortex.cpp'
    this.api = ky.extend({
        prefixUrl: API_URL,
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      })
    // Run Healthcheck
    this.queue.add(() => this.healthz())
  }

  /**
   * Called when the extension is unloaded.
   */
  onUnload() {}

  /**
   * Do health check on cortex.cpp
   * @returns
   */
  async healthz(): Promise<void> {
    return this.api
      .get('healthz', {
        retry: { limit: 20, delay: () => 500, methods: ['get'] },
      })
      .then(() => {})
  }

  /**
   * @returns A Promise that resolves to an object of hardware.
   */
  async getHardware(): Promise<HardwareInformation> {
    return this.queue.add(() =>
      this.api
        .get('v1/hardware')
        .json<HardwareInformation>()
        .then((e) => e)
    ) as Promise<HardwareInformation>
  }

  /**
   * @returns A Promise that resolves to an object of set gpu activate.
   */
  async setAvtiveGpu(data: { gpus: number[] }): Promise<{
    message: string
    activated_gpus: number[]
  }> {
    return this.queue.add(() =>
      this.api.post('v1/hardware/activate', { json: data }).then((e) => e)
    ) as Promise<{
      message: string
      activated_gpus: number[]
    }>
  }
}
