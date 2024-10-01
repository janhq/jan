// useGpuSetting.test.ts

import { renderHook, act } from '@testing-library/react'
import { ExtensionTypeEnum, MonitoringExtension } from '@janhq/core'

// Mock dependencies
jest.mock('@/extension')

import useGpuSetting from './useGpuSetting'
import { extensionManager } from '@/extension'

describe('useGpuSetting', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('should return GPU settings when available', async () => {
    const mockGpuSettings = {
      gpuCount: 2,
      gpuNames: ['NVIDIA GeForce RTX 3080', 'NVIDIA GeForce RTX 3070'],
      totalMemory: 20000,
      freeMemory: 15000,
    }

    const mockMonitoringExtension: Partial<MonitoringExtension> = {
      getGpuSetting: jest.fn().mockResolvedValue(mockGpuSettings),
    }

    jest
      .spyOn(extensionManager, 'get')
      .mockReturnValue(mockMonitoringExtension as MonitoringExtension)

    const { result } = renderHook(() => useGpuSetting())

    let gpuSettings
    await act(async () => {
      gpuSettings = await result.current.getGpuSettings()
    })

    expect(gpuSettings).toEqual(mockGpuSettings)
    expect(extensionManager.get).toHaveBeenCalledWith(
      ExtensionTypeEnum.SystemMonitoring
    )
    expect(mockMonitoringExtension.getGpuSetting).toHaveBeenCalled()
  })

  it('should return undefined when no GPU settings are found', async () => {
    const mockMonitoringExtension: Partial<MonitoringExtension> = {
      getGpuSetting: jest.fn().mockResolvedValue(undefined),
    }

    jest
      .spyOn(extensionManager, 'get')
      .mockReturnValue(mockMonitoringExtension as MonitoringExtension)

    const { result } = renderHook(() => useGpuSetting())

    let gpuSettings
    await act(async () => {
      gpuSettings = await result.current.getGpuSettings()
    })

    expect(gpuSettings).toBeUndefined()
    expect(extensionManager.get).toHaveBeenCalledWith(
      ExtensionTypeEnum.SystemMonitoring
    )
    expect(mockMonitoringExtension.getGpuSetting).toHaveBeenCalled()
  })

  it('should handle missing MonitoringExtension', async () => {
    jest.spyOn(extensionManager, 'get').mockReturnValue(undefined)
    jest.spyOn(console, 'debug').mockImplementation(() => {})

    const { result } = renderHook(() => useGpuSetting())

    let gpuSettings
    await act(async () => {
      gpuSettings = await result.current.getGpuSettings()
    })

    expect(gpuSettings).toBeUndefined()
    expect(extensionManager.get).toHaveBeenCalledWith(
      ExtensionTypeEnum.SystemMonitoring
    )
    expect(console.debug).toHaveBeenCalledWith('No GPU setting found')
  })
})
