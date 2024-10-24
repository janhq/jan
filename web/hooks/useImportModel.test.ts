// useImportModel.test.ts

import { renderHook, act } from '@testing-library/react'
import { extensionManager } from '@/extension'
import useImportModel from './useImportModel'

// Mock dependencies
jest.mock('@janhq/core')
jest.mock('@/extension')
jest.mock('@/containers/Toast')
jest.mock('uuid', () => ({ v4: () => 'mocked-uuid' }))

describe('useImportModel', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('should import models successfully', async () => {
    const mockImportModels = jest.fn().mockResolvedValue(undefined)
    const mockExtension = {
      importModel: mockImportModels,
    } as any

    jest.spyOn(extensionManager, 'get').mockReturnValue(mockExtension)

    const { result } = renderHook(() => useImportModel())

    const models = [
      { modelId: '1', path: '/path/to/model1' },
      { modelId: '2', path: '/path/to/model2' },
    ] as any

    await act(async () => {
      await result.current.importModels(models, 'local' as any)
    })

    expect(mockImportModels).toHaveBeenCalledWith('1', '/path/to/model1')
    expect(mockImportModels).toHaveBeenCalledWith('2', '/path/to/model2')
  })

  it('should update model info successfully', async () => {
    const mockUpdateModelInfo = jest
      .fn()
      .mockResolvedValue({ id: 'model-1', name: 'Updated Model' })
    const mockExtension = {
      updateModel: mockUpdateModelInfo,
    } as any

    jest.spyOn(extensionManager, 'get').mockReturnValue(mockExtension)

    const { result } = renderHook(() => useImportModel())

    const modelInfo = { id: 'model-1', name: 'Updated Model' }

    await act(async () => {
      await result.current.updateModelInfo(modelInfo)
    })

    expect(mockUpdateModelInfo).toHaveBeenCalledWith(modelInfo)
  })

  it('should handle empty file paths', async () => {
    const { result } = renderHook(() => useImportModel())

    await act(async () => {
      await result.current.sanitizeFilePaths([])
    })

    // Expect no state changes or side effects
  })
})
