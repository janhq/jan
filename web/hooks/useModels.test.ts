// useModels.test.ts
import { renderHook, act, waitFor } from '@testing-library/react'
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
        has: () => true,
      },
    })

    jest.spyOn(extensionManager, 'get').mockReturnValue(mockModelExtension)

    const { result } = renderHook(() => useModels())
    await act(() => {
      result.current?.getData()
    })

    expect(mockModelExtension.getModels).toHaveBeenCalled()
  })

  it('should return empty on error', async () => {
    const mockModelExtension = {
      getModels: jest.fn().mockRejectedValue(new Error('Error')),
    } as any
    ;(ModelManager.instance as jest.Mock).mockReturnValue({
      models: {
        values: () => ({
          toArray: () => ({
            filter: () => models,
          }),
        }),
        get: () => undefined,
        has: () => true,
      },
    })

    jest.spyOn(extensionManager, 'get').mockReturnValue(mockModelExtension)

    const { result } = renderHook(() => useModels())

    await act(() => {
      result.current?.getData()
    })

    expect(mockModelExtension.getModels()).rejects.toThrow()
  })

  it('should update states on models update', async () => {
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
        has: () => true,
      },
    })

    jest.spyOn(extensionManager, 'get').mockReturnValue(mockModelExtension)
    jest.spyOn(events, 'on').mockImplementationOnce((event, cb) => {
      cb({ fetch: false })
    })
    renderHook(() => useModels())

    expect(mockModelExtension.getModels).not.toHaveBeenCalled()
  })

  it('should update states on models update', async () => {
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
        has: () => true,
      },
    })

    jest.spyOn(extensionManager, 'get').mockReturnValue(mockModelExtension)
    jest.spyOn(events, 'on').mockImplementationOnce((event, cb) => {
      cb({ fetch: true })
    })
    renderHook(() => useModels())

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
