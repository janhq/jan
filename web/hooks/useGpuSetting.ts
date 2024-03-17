import { useCallback } from 'react'

import { ExtensionTypeEnum, MonitoringExtension } from '@janhq/core'

import { extensionManager } from '@/extension'

export default function useGpuSetting() {
  const getGpuSettings = useCallback(async () => {
    const gpuSetting = await extensionManager
      ?.get<MonitoringExtension>(ExtensionTypeEnum.SystemMonitoring)
      ?.getGpuSetting()

    if (!gpuSetting) {
      console.debug('No GPU setting found')
      return undefined
    }
    return gpuSetting
  }, [])

  return { getGpuSettings }
}
