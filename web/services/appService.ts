import {
  ExtensionTypeEnum,
  HardwareManagementExtension,
  // OperatingSystemInfo,
  SupportedPlatform,
  // MonitoringExtension,
  SystemInformation,
  GpuSetting,
  GpuSettingInfo,
} from '@janhq/core'

import { toaster } from '@/containers/Toast'

import { extensionManager } from '@/extension'

export const appService = {
  systemInformation: async (): Promise<SystemInformation | undefined> => {
    // const monitorExtension = extensionManager?.get<MonitoringExtension>(
    //   ExtensionTypeEnum.SystemMonitoring
    // )

    const hardwareExtension =
      extensionManager?.get<HardwareManagementExtension>(
        ExtensionTypeEnum.Hardware
      )

    // if (!monitorExtension) {
    //   console.warn('System monitoring extension not found')
    //   return undefined
    // }

    if (!hardwareExtension) {
      console.warn('Hardware extension not found')
      return undefined
    }

    // const gpuSetting = await monitorExtension.getGpuSetting()
    // const osInfo = await monitorExtension.getOsInfo()
    const hardwareInfo = await hardwareExtension?.getHardware()

    const gpuSettingInfo: GpuSetting | undefined = {
      gpus: hardwareInfo.gpus as GpuSettingInfo[],
      vulkan: false,
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
