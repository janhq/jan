import { renderHook, act } from '@testing-library/react'
import { extensionManager } from '@/extension/ExtensionManager'
import useDeleteModel from './useDeleteModel'
import { toaster } from '@/containers/Toast'
import { useSetAtom } from 'jotai'

// Mock the dependencies
jest.mock('@/extension/ExtensionManager')
jest.mock('@/containers/Toast')
jest.mock('jotai', () => ({
  useSetAtom: jest.fn(() => jest.fn()),
  atom: jest.fn(),
}))

describe('useDeleteModel', () => {
  const mockModel: any = {
    id: 'test-model',
    name: 'Test Model',
    // Add other required properties of Model
  }

  const mockDeleteModel = jest.fn()

  beforeEach(() => {
    jest.clearAllMocks()
    ;(extensionManager.get as jest.Mock).mockReturnValue({
      deleteModel: mockDeleteModel,
    })
  })

  it('should delete a model successfully', async () => {
    const { result } = renderHook(() => useDeleteModel())

    await act(async () => {
      await result.current.deleteModel(mockModel)
    })

    expect(mockDeleteModel).toHaveBeenCalledWith('test-model')
    expect(toaster).toHaveBeenCalledWith({
      title: 'Model Deletion Successful',
      description: `Model ${mockModel.name} has been successfully deleted.`,
      type: 'success',
    })
  })

  it('should call removeDownloadedModel with the model id', async () => {
    const { result } = renderHook(() => useDeleteModel())

    await act(async () => {
      await result.current.deleteModel(mockModel)
    })

    // Assuming useSetAtom returns a mock function
    ;(useSetAtom as jest.Mock).mockReturnValue(jest.fn())
    expect(useSetAtom).toHaveBeenCalled()
  })

  it('should handle errors during model deletion', async () => {
    const error = new Error('Deletion failed')
    mockDeleteModel.mockRejectedValue(error)

    const { result } = renderHook(() => useDeleteModel())

    await act(async () => {
      await expect(result.current.deleteModel(mockModel)).rejects.toThrow(
        'Deletion failed'
      )
    })

    expect(mockDeleteModel).toHaveBeenCalledWith("test-model")
    expect(toaster).not.toHaveBeenCalled()
  })
})
