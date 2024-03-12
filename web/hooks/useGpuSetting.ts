import { useCallback } from 'react'

import { ExtensionTypeEnum, MonitoringExtension } from '@janhq/core'

import { extensionManager } from '@/extension'

export default function useGpuSetting() {
  const getGpuSettings = useCallback(async () => {
    const gpuSetting = await extensionManager
      ?.get<MonitoringExtension>(ExtensionTypeEnum.SystemMonitoring)
      ?.getGpuSetting()

    if (!gpuSetting) {
      // TODO: remove this. For mac testing only
      return {
        notify: true,
        run_mode: 'cpu',
        nvidia_driver: { exist: true, version: '546.33' },
        cuda: { exist: true, version: '12' },
        gpus: [{ id: '0', vram: '12288', name: 'NVIDIA GeForce RTX 3060' }],
        gpu_highest_vram: '0',
        gpus_in_use: ['0'],
        is_initial: false,
        vulkan: false,
      }
    }
    return gpuSetting
  }, [])

  return { getGpuSettings }
}
