import { renderHook, act } from '@testing-library/react'
import { useAtom, useSetAtom } from 'jotai'
import useDownloadModel from './useDownloadModel'
import * as core from '@janhq/core'
import { extensionManager } from '@/extension/ExtensionManager'

// Mock the necessary dependencies
jest.mock('jotai', () => ({
  useAtomValue: jest.fn(),
  useSetAtom: jest.fn(),
  useAtom: jest.fn(),
  atom: jest.fn(),
}))
jest.mock('@janhq/core')
jest.mock('@/extension/ExtensionManager')
jest.mock('./useGpuSetting', () => ({
  __esModule: true,
  default: () => ({
    getGpuSettings: jest.fn().mockResolvedValue({ some: 'gpuSettings' }),
  }),
}))

describe('useDownloadModel', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(useAtom as jest.Mock).mockReturnValue([false, jest.fn()])
  })

  it('should download a model', async () => {
    const mockModel: core.Model = {
      id: 'test-model',
      sources: [{ filename: 'test.bin' }],
    } as core.Model

    const mockExtension = {
      downloadModel: jest.fn().mockResolvedValue(undefined),
    }
    ;(useSetAtom as jest.Mock).mockReturnValue(() => undefined)
    ;(extensionManager.get as jest.Mock).mockReturnValue(mockExtension)

    const { result } = renderHook(() => useDownloadModel())

    await act(async () => {
      await result.current.downloadModel(mockModel)
    })

    expect(mockExtension.downloadModel).toHaveBeenCalledWith(
      mockModel,
      { some: 'gpuSettings' },
      { ignoreSSL: undefined, proxy: '' }
    )
  })

  it('should abort model download', async () => {
    const mockModel: core.Model = {
      id: 'test-model',
      sources: [{ filename: 'test.bin' }],
    } as core.Model

    ;(core.joinPath as jest.Mock).mockResolvedValue('/path/to/model/test.bin')
    ;(core.abortDownload as jest.Mock).mockResolvedValue(undefined)
    ;(useSetAtom as jest.Mock).mockReturnValue(() => undefined)
    const { result } = renderHook(() => useDownloadModel())

    await act(async () => {
      await result.current.abortModelDownload(mockModel)
    })

    expect(core.abortDownload).toHaveBeenCalledWith('/path/to/model/test.bin')
  })

  it('should handle proxy settings', async () => {
    const mockModel: core.Model = {
      id: 'test-model',
      sources: [{ filename: 'test.bin' }],
    } as core.Model

    const mockExtension = {
      downloadModel: jest.fn().mockResolvedValue(undefined),
    }
    ;(useSetAtom as jest.Mock).mockReturnValue(() => undefined)
    ;(extensionManager.get as jest.Mock).mockReturnValue(mockExtension)
    ;(useAtom as jest.Mock).mockReturnValueOnce([true, jest.fn()]) // proxyEnabled
    ;(useAtom as jest.Mock).mockReturnValueOnce(['http://proxy.com', jest.fn()]) // proxy

    const { result } = renderHook(() => useDownloadModel())

    await act(async () => {
      await result.current.downloadModel(mockModel)
    })

    expect(mockExtension.downloadModel).toHaveBeenCalledWith(
      mockModel,
      expect.objectContaining({ some: 'gpuSettings' }),
      expect.anything()
    )
  })
})
