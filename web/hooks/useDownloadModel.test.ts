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

describe('useDownloadModel', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(useAtom as jest.Mock).mockReturnValue([false, jest.fn()])
  })

  it('should download a model', async () => {
    const mockModel: core.Model = {
      id: 'test-model',
      sources: [{ filename: 'test.bin', url: 'https://fake.url' }],
    } as core.Model

    const mockExtension = {
      pullModel: jest.fn().mockResolvedValue(undefined),
    }
    ;(useSetAtom as jest.Mock).mockReturnValue(() => undefined)
    ;(extensionManager.get as jest.Mock).mockReturnValue(mockExtension)

    const { result } = renderHook(() => useDownloadModel())

    act(() => {
      result.current.downloadModel(mockModel.sources[0].url, mockModel.id)
    })

    expect(mockExtension.pullModel).toHaveBeenCalledWith(
      mockModel.sources[0].url,
      mockModel.id
    )
  })

  it('should abort model download', async () => {
    const mockModel: core.Model = {
      id: 'test-model',
      sources: [{ filename: 'test.bin' }],
    } as core.Model

    ;(core.joinPath as jest.Mock).mockResolvedValue('/path/to/model/test.bin')
    const mockExtension = {
      cancelModelPull: jest.fn().mockResolvedValue(undefined),
    }
    ;(useSetAtom as jest.Mock).mockReturnValue(() => undefined)
    ;(extensionManager.get as jest.Mock).mockReturnValue(mockExtension)
    const { result } = renderHook(() => useDownloadModel())

    act(() => {
      result.current.abortModelDownload(mockModel.id)
    })

    expect(mockExtension.cancelModelPull).toHaveBeenCalledWith('test-model')
  })

  it('should handle proxy settings', async () => {
    const mockModel: core.Model = {
      id: 'test-model',
      sources: [{ filename: 'test.bin' }],
    } as core.Model

    const mockExtension = {
      pullModel: jest.fn().mockResolvedValue(undefined),
    }
    ;(useSetAtom as jest.Mock).mockReturnValue(() => undefined)
    ;(extensionManager.get as jest.Mock).mockReturnValue(mockExtension)
    ;(useAtom as jest.Mock).mockReturnValueOnce([true, jest.fn()]) // proxyEnabled
    ;(useAtom as jest.Mock).mockReturnValueOnce(['http://proxy.com', jest.fn()]) // proxy

    const { result } = renderHook(() => useDownloadModel())

    act(() => {
      result.current.downloadModel(mockModel.sources[0].url, mockModel.id)
    })

    expect(mockExtension.pullModel).toHaveBeenCalledWith(
      mockModel.sources[0].url,
      mockModel.id
    )
  })
})
