import { HardwareInformation } from '../../types'
import { BaseExtension, ExtensionTypeEnum } from '../extension'

/**
 * Engine management extension. Persists and retrieves engine management.
 * @abstract
 * @extends BaseExtension
 */
export abstract class HardwareManagementExtension extends BaseExtension {
  type(): ExtensionTypeEnum | undefined {
    return ExtensionTypeEnum.Hardware
  }

  /**
   * @returns A Promise that resolves to an object of list hardware.
   */
  abstract getHardware(): Promise<HardwareInformation>

  /**
   * @returns A Promise that resolves to an object of set active gpus.
   */
  abstract setAvtiveGpu(data: { gpus: number[] }): Promise<{
    message: string
    activated_gpus: number[]
  }>
}
