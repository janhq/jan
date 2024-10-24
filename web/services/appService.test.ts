import { extensionManager } from '@/extension'
import { appService } from './appService'

test('should return correct system information when monitoring extension is found', async () => {
  const mockGpuSetting = { name: 'NVIDIA GeForce GTX 1080', memory: 8192 }
  const mockOsInfo = { platform: 'win32', release: '10.0.19041' }
  const mockMonitoringExtension = {
    getGpuSetting: jest.fn().mockResolvedValue(mockGpuSetting),
    getOsInfo: jest.fn().mockResolvedValue(mockOsInfo),
  }
  extensionManager.get = jest.fn().mockReturnValue(mockMonitoringExtension)

  const result = await appService.systemInformation()

  expect(mockMonitoringExtension.getGpuSetting).toHaveBeenCalled()
  expect(mockMonitoringExtension.getOsInfo).toHaveBeenCalled()
  expect(result).toEqual({ gpuSetting: mockGpuSetting, osInfo: mockOsInfo })
})

test('should log a warning when monitoring extension is not found', async () => {
  const consoleWarnMock = jest
    .spyOn(console, 'warn')
    .mockImplementation(() => {})
  extensionManager.get = jest.fn().mockReturnValue(undefined)

  await appService.systemInformation()

  expect(consoleWarnMock).toHaveBeenCalledWith(
    'System monitoring extension not found'
  )
  consoleWarnMock.mockRestore()
})
