import { ExtensionTypeEnum, MonitoringExtension } from '@janhq/core'

import { toaster } from '@/containers/Toast'

import { extensionManager } from '@/extension'

export const appService = {
  systemInformations: async () => {
    const gpuSetting = await extensionManager
      ?.get<MonitoringExtension>(ExtensionTypeEnum.SystemMonitoring)
      ?.getGpuSetting()

    return {
      gpuSetting,
      // TODO: Other system information
    }
  },
  showToast: (title: string, description: string) => {
    toaster({
      title,
      description: description,
    })
  },
}
