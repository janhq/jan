import {
  ExtensionTypeEnum,
  HardwareManagementExtension,
  MonitoringExtension,
  SystemInformation,
} from '@janhq/core'

import { toaster } from '@/containers/Toast'

import { extensionManager } from '@/extension'

export const appService = {
  systemInformation: async (): Promise<SystemInformation | undefined> => {
    const monitorExtension = extensionManager?.get<MonitoringExtension>(
      ExtensionTypeEnum.SystemMonitoring
    )
    const hardwareExtension =
      extensionManager?.get<HardwareManagementExtension>(
        ExtensionTypeEnum.Hardware
      )
    if (!monitorExtension) {
      console.warn('System monitoring extension not found')
      return undefined
    }

    if (!hardwareExtension) {
      console.warn('Hardware extension not found')
      return undefined
    }

    const gpuSetting = await monitorExtension.getGpuSetting()
    const osInfo = await monitorExtension.getOsInfo()
    const hardwareInfo = await hardwareExtension?.getHardware()

    const updateOsInfo = {
      ...osInfo,
      arch: hardwareInfo.cpu.arch,
      freeMem: hardwareInfo.ram.available,
      totalMem: hardwareInfo.ram.total,
    }

    return {
      gpuSetting,
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
