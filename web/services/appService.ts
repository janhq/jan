import {
  ExtensionTypeEnum,
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
    if (!monitorExtension) {
      console.warn('System monitoring extension not found')
      return undefined
    }

    const gpuSetting = await monitorExtension.getGpuSetting()
    const osInfo = await monitorExtension.getOsInfo()

    return {
      gpuSetting,
      osInfo,
    }
  },

  showToast: (title: string, description: string) => {
    toaster({
      title,
      description: description,
    })
  },
}
