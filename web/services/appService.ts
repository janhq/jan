import { DefaultEngineVariant } from './../../core/src/types/engine/index'
import {
  ExtensionTypeEnum,
  HardwareManagementExtension,
  // OperatingSystemInfo,
  SupportedPlatform,
  // MonitoringExtension,
  SystemInformation,
  GpuSetting,
  GpuSettingInfo,
  EngineManagementExtension,
} from '@janhq/core'

import { toaster } from '@/containers/Toast'

import { extensionManager } from '@/extension'
import { useAtomValue } from 'jotai'
import { LocalEngineDefaultVariantAtom } from '@/helpers/atoms/App.atom'

export const appService = {
  systemInformation: async (): Promise<SystemInformation | undefined> => {
    // const monitorExtension = extensionManager?.get<MonitoringExtension>(
    //   ExtensionTypeEnum.SystemMonitoring
    // )

    const selectedVariants = useAtomValue(LocalEngineDefaultVariantAtom)

    const hardwareExtension =
      extensionManager?.get<HardwareManagementExtension>(
        ExtensionTypeEnum.Hardware
      )

    const engineExtension = extensionManager?.get<EngineManagementExtension>(
      ExtensionTypeEnum.Engine
    )

    // if (!monitorExtension) {
    //   console.warn('System monitoring extension not found')
    //   return undefined
    // }

    if (!hardwareExtension) {
      console.warn('Hardware extension not found')
      return undefined
    }

    if (!engineExtension) {
      console.warn('Engine extension not found')
      return undefined
    }

    // const gpuSetting = await monitorExtension.getGpuSetting()
    // const osInfo = await monitorExtension.getOsInfo()
    const hardwareInfo = await hardwareExtension?.getHardware()

    const gpuSettingInfo: GpuSetting | undefined = {
      gpus: hardwareInfo.gpus as GpuSettingInfo[],
      vulkan: isMac ? false : selectedVariants.includes('vulkan'),
    }

    const updateOsInfo = {
      // ...osInfo,
      platform: PLATFORM as SupportedPlatform,
      arch: hardwareInfo.cpu.arch,
      freeMem: hardwareInfo.ram.available,
      totalMem: hardwareInfo.ram.total,
    }

    // console.log(osInfo)
    // console.log(hardwareInfo)

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
