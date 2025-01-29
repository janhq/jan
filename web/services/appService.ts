import {
  ExtensionTypeEnum,
  HardwareManagementExtension,
  SupportedPlatform,
  // MonitoringExtension,
  SystemInformation,
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

    const updateOsInfo = {
      // ...osInfo,
      machine: hardwareInfo.cpu.model,
      platform: 'darwin' as SupportedPlatform,
      release: hardwareInfo.os.version.match(/\d+\.\d+\.\d+/)?.[0] || '',
      version: hardwareInfo.os.version,
      arch: hardwareInfo.cpu.arch,
      freeMem: hardwareInfo.ram.available,
      totalMem: hardwareInfo.ram.total,
    }

    // console.log(osInfo)
    // console.log(hardwareInfo)

    return {
      // gpuSetting,
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
