import { useCallback } from 'react'

import { ExtensionTypeEnum, MonitoringExtension } from '@janhq/core'

import { extensionManager } from '@/extension'

export default function useGpuSetting() {
  const getGpuSettings = useCallback(async () => {
    const monitoring = extensionManager.get<MonitoringExtension>(
      ExtensionTypeEnum.SystemMonitoring
    )

    if (!monitoring) {
      return
    }

    const gpuConfig = await monitoring.getGpuSetting()
    console.log(gpuConfig)
  }, [])

  return { getGpuSettings }
}
