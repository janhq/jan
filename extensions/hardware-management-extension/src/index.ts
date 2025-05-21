import { HardwareManagementExtension, HardwareInformation } from '@janhq/core'
import ky, { KyInstance } from 'ky'

/**
 * JSONHardwareManagementExtension is a HardwareManagementExtension implementation that provides
 * functionality for managing engines.
 */
export default class JSONHardwareManagementExtension extends HardwareManagementExtension {
  /**
   * Called when the extension is loaded.
   */
  async onLoad() {}

  api?: KyInstance
  /**
   * Get the API instance
   * @returns
   */
  async apiInstance(): Promise<KyInstance> {
    if (this.api) return this.api
    const apiKey = (await window.core?.api.appToken())
    this.api = ky.extend({
      prefixUrl: API_URL,
      headers: apiKey
        ? {
            Authorization: `Bearer ${apiKey}`,
          }
        : {},
      retry: 10,
    })
    return this.api
  }

  /**
   * Called when the extension is unloaded.
   */
  onUnload() {}

  /**
   * @returns A Promise that resolves to an object of hardware.
   */
  async getHardware(): Promise<HardwareInformation> {
    return this.apiInstance().then((api) =>
      api
        .get('v1/hardware')
        .json<HardwareInformation>()
        .then((e) => e)
    ) as Promise<HardwareInformation>
  }

  /**
   * @returns A Promise that resolves to an object of set gpu activate.
   */
  async setActiveGpu(data: { gpus: number[] }): Promise<{
    message: string
    activated_gpus: number[]
  }> {
    return this.apiInstance().then((api) =>
      api.post('v1/hardware/activate', { json: data }).then((e) => e)
    ) as Promise<{
      message: string
      activated_gpus: number[]
    }>
  }
}
