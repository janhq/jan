// useModels.test.ts

import { renderHook, act } from '@testing-library/react'
import { events, ModelEvent } from '@janhq/core'
import { extensionManager } from '@/extension'

// Mock dependencies
jest.mock('@janhq/core')
jest.mock('@/extension')

import useModels from './useModels'

// Mock data
const mockDownloadedModels = [
  { id: 'model-1', name: 'Model 1' },
  { id: 'model-2', name: 'Model 2' },
]

const mockConfiguredModels = [
  { id: 'model-3', name: 'Model 3' },
  { id: 'model-4', name: 'Model 4' },
]

const mockDefaultModel = { id: 'default-model', name: 'Default Model' }

describe('useModels', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('should fetch and set models on mount', async () => {
    const mockModelExtension = {
      getDownloadedModels: jest.fn().mockResolvedValue(mockDownloadedModels),
      getConfiguredModels: jest.fn().mockResolvedValue(mockConfiguredModels),
      getDefaultModel: jest.fn().mockResolvedValue(mockDefaultModel),
    } as any

    jest.spyOn(extensionManager, 'get').mockReturnValue(mockModelExtension)

    await act(async () => {
      renderHook(() => useModels())
    })

    expect(mockModelExtension.getDownloadedModels).toHaveBeenCalled()
    expect(mockModelExtension.getConfiguredModels).toHaveBeenCalled()
    expect(mockModelExtension.getDefaultModel).toHaveBeenCalled()
  })

  it('should remove event listener on unmount', async () => {
    const removeListenerSpy = jest.spyOn(events, 'off')

    const { unmount } = renderHook(() => useModels())

    unmount()

    expect(removeListenerSpy).toHaveBeenCalledWith(
      ModelEvent.OnModelsUpdate,
      expect.any(Function)
    )
  })
})
