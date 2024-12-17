/**
 * @jest-environment jsdom
 */
// useDropModelBinaries.test.ts

import { renderHook, act } from '@testing-library/react'
import { useSetAtom } from 'jotai'
import { v4 as uuidv4 } from 'uuid'
import useDropModelBinaries from './useDropModelBinaries'
import { getFileInfoFromFile } from '@/utils/file'
import { snackbar } from '@/containers/Toast'

// Mock dependencies
// Mock the necessary dependencies
jest.mock('jotai', () => ({
  useAtomValue: jest.fn(),
  useSetAtom: jest.fn(),
  useAtom: jest.fn(),
  atom: jest.fn(),
}))
jest.mock('uuid')
jest.mock('@/utils/file')
jest.mock('@/containers/Toast')
jest.mock("@uppy/core")

describe('useDropModelBinaries', () => {
  const mockSetImportingModels = jest.fn()
  const mockSetImportModelStage = jest.fn()

  beforeEach(() => {
    jest.clearAllMocks()
    ;(useSetAtom as jest.Mock).mockReturnValueOnce(mockSetImportingModels)
    ;(useSetAtom as jest.Mock).mockReturnValueOnce(mockSetImportModelStage)
    ;(uuidv4 as jest.Mock).mockReturnValue('mock-uuid')
    ;(getFileInfoFromFile as jest.Mock).mockResolvedValue([])
  })

  it('should handle dropping supported files', async () => {
    const { result } = renderHook(() => useDropModelBinaries())

    const mockFiles = [
      { name: 'model1.gguf', path: '/path/to/model1.gguf', size: 1000 },
      { name: 'model2.gguf', path: '/path/to/model2.gguf', size: 2000 },
    ]

    ;(getFileInfoFromFile as jest.Mock).mockResolvedValue(mockFiles)

    await act(async () => {
      await result.current.onDropModels([])
    })

    expect(mockSetImportingModels).toHaveBeenCalledWith([
      {
        importId: 'mock-uuid',
        modelId: undefined,
        name: 'model1',
        description: '',
        path: '/path/to/model1.gguf',
        tags: [],
        size: 1000,
        status: 'PREPARING',
        format: 'gguf',
      },
      {
        importId: 'mock-uuid',
        modelId: undefined,
        name: 'model2',
        description: '',
        path: '/path/to/model2.gguf',
        tags: [],
        size: 2000,
        status: 'PREPARING',
        format: 'gguf',
      },
    ])
    expect(mockSetImportModelStage).toHaveBeenCalledWith('MODEL_SELECTED')
  })

  it('should handle dropping unsupported files', async () => {
    const { result } = renderHook(() => useDropModelBinaries())

    const mockFiles = [
      { name: 'unsupported.txt', path: '/path/to/unsupported.txt', size: 500 },
    ]

    ;(getFileInfoFromFile as jest.Mock).mockResolvedValue(mockFiles)

    await act(async () => {
      await result.current.onDropModels([])
    })

    expect(snackbar).toHaveBeenCalledWith({
      description: 'Only files with .gguf extension can be imported.',
      type: 'error',
    })
    expect(mockSetImportingModels).not.toHaveBeenCalled()
    expect(mockSetImportModelStage).not.toHaveBeenCalled()
  })

  it('should handle dropping both supported and unsupported files', async () => {
    const { result } = renderHook(() => useDropModelBinaries())

    const mockFiles = [
      { name: 'model.gguf', path: '/path/to/model.gguf', size: 1000 },
      { name: 'unsupported.txt', path: '/path/to/unsupported.txt', size: 500 },
    ]

    ;(getFileInfoFromFile as jest.Mock).mockResolvedValue(mockFiles)

    await act(async () => {
      await result.current.onDropModels([])
    })

    expect(snackbar).toHaveBeenCalledWith({
      description: 'Only files with .gguf extension can be imported.',
      type: 'error',
    })
    expect(mockSetImportingModels).toHaveBeenCalledWith([
      {
        importId: 'mock-uuid',
        modelId: undefined,
        name: 'model',
        description: '',
        path: '/path/to/model.gguf',
        tags: [],
        size: 1000,
        status: 'PREPARING',
        format: 'gguf',
      },
    ])
    expect(mockSetImportModelStage).toHaveBeenCalledWith('MODEL_SELECTED')
  })
})
