import {
  ExtensionTypeEnum,
  HardwareManagementExtension,
  SupportedPlatform,
  SystemInformation,
  GpuSetting,
  GpuSettingInfo,
} from '@janhq/core'

import { getDefaultStore } from 'jotai'

import { toaster } from '@/containers/Toast'

import { extensionManager } from '@/extension'

import { LocalEngineDefaultVariantAtom } from '@/helpers/atoms/App.atom'

export const appService = {
  systemInformation: async (): Promise<SystemInformation | undefined> => {
    const selectedVariants = getDefaultStore().get(
      LocalEngineDefaultVariantAtom
    )

    const hardwareExtension =
      extensionManager?.get<HardwareManagementExtension>(
        ExtensionTypeEnum.Hardware
      )

    if (!hardwareExtension) {
      console.warn('Hardware extension not found')
      return undefined
    }

    const hardwareInfo = await hardwareExtension?.getHardware()

    const gpuSettingInfo: GpuSetting | undefined = {
      gpus: hardwareInfo.gpus.filter(
        (gpu) => gpu.total_vram > 0
      ) as GpuSettingInfo[],
      vulkan: isMac ? false : selectedVariants.includes('vulkan'),
      cpu: hardwareInfo.cpu,
    }

    const updateOsInfo = {
      platform: PLATFORM as SupportedPlatform,
      arch: hardwareInfo.cpu.arch,
      freeMem: hardwareInfo.ram.available,
      totalMem: hardwareInfo.ram.total,
    }

    return {
      gpuSetting: gpuSettingInfo,
      osInfo: updateOsInfo,
    }
  },

  showToast: (title: string, description: string) => {
    toaster({
      title,
      description: description,
    })
  },
}
