// useModels.test.ts
import { renderHook, act } from '@testing-library/react'
import { events, ModelEvent, ModelManager } from '@janhq/core'
import { extensionManager } from '@/extension'

// Mock dependencies
jest.mock('@janhq/core')
jest.mock('@/extension')
jest.mock('use-debounce', () => ({
  useDebouncedCallback: jest.fn().mockImplementation((fn) => fn),
}))

import useModels from './useModels'

// Mock data
const models = [
  { id: 'model-1', name: 'Model 1' },
  { id: 'model-2', name: 'Model 2' },
]

describe('useModels', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('should fetch and set models on mount', async () => {
    const mockModelExtension = {
      getModels: jest.fn().mockResolvedValue(models),
    } as any
    ;(ModelManager.instance as jest.Mock).mockReturnValue({
      models: {
        values: () => ({
          toArray: () => ({
            filter: () => models,
          }),
        }),
        get: () => undefined,
      },
    })

    jest.spyOn(extensionManager, 'get').mockReturnValue(mockModelExtension)

    act(() => {
      renderHook(() => useModels())
    })

    expect(mockModelExtension.getModels).toHaveBeenCalled()
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
