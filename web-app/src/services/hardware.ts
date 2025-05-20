import { ExtensionManager } from '@/lib/extension'
import { ExtensionTypeEnum, HardwareManagementExtension } from '@janhq/core'

/**
 * Get hardware information from the HardwareManagementExtension.
 * @returns {Promise<HardwareInfo>} A promise that resolves to the hardware information.
 */
export const getHardwareInfo = async () => {
  const extension =
    ExtensionManager.getInstance().get<HardwareManagementExtension>(
      ExtensionTypeEnum.Hardware
    )

  if (!extension) throw new Error('Model extension not found')

  try {
    return await extension?.getHardware()
  } catch (error) {
    console.error('Failed to download model:', error)
    throw error
  }
}
