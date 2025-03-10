import { HardwareManagementExtension, HardwareInformation } from '@janhq/core'
import ky from 'ky'
import PQueue from 'p-queue'

/**
 * JSONHardwareManagementExtension is a HardwareManagementExtension implementation that provides
 * functionality for managing engines.
 */
export default class JSONHardwareManagementExtension extends HardwareManagementExtension {
  queue = new PQueue({ concurrency: 1 })

  /**
   * Called when the extension is loaded.
   */
  async onLoad() {
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
    return ky
      .get(`${API_URL}/healthz`, {
        retry: { limit: 20, delay: () => 500, methods: ['get'] },
      })
      .then(() => {})
  }

  /**
   * @returns A Promise that resolves to an object of hardware.
   */
  async getHardware(): Promise<HardwareInformation> {
    return this.queue.add(() =>
      ky
        .get(`${API_URL}/v1/hardware`)
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
      ky.post(`${API_URL}/v1/hardware/activate`, { json: data }).then((e) => e)
    ) as Promise<{
      message: string
      activated_gpus: number[]
    }>
  }
}
