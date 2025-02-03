import { extensionManager } from '@/extension'
import { appService } from './appService'

test('should return correct system information when hardware extension is found', async () => {

  (global as any).isMac = false;
  (global as any).PLATFORM = "win32";

  const mock = { cpu: { arch: 'arc' }, ram: { available: 4000, total: 8000 }, gpus: [{name: 'NVIDIA GeForce GTX 1080', total_vram: 8192}] }

  const mockHardwareExtension = {
    getHardware: jest.fn().mockResolvedValue(mock),
  }
  extensionManager.get = jest.fn().mockReturnValue(mockHardwareExtension)

  const result = await appService.systemInformation()

  expect(mockHardwareExtension.getHardware).toHaveBeenCalled()

  expect(result).toEqual({
    gpuSetting: {gpus: mock.gpus, vulkan: false, cpu: {arch: mock.cpu.arch},},
    osInfo: {
      platform: 'win32',
      arch: mock.cpu.arch,
      freeMem: mock.ram.available,
      totalMem: mock.ram.total,
    },
  })
})

test('should log a warning when hardware extension is not found', async () => {
  const consoleWarnMock = jest
    .spyOn(console, 'warn')
    .mockImplementation(() => {})
  extensionManager.get = jest.fn().mockReturnValue(undefined)

  await appService.systemInformation()

  expect(consoleWarnMock).toHaveBeenCalledWith(
    'Hardware extension not found'
  )
  consoleWarnMock.mockRestore()
})
