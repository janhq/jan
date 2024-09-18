import {
  setDownloadStateAtom,
  modelDownloadStateAtom,
} from './useDownloadState'

// Mock dependencies
jest.mock('jotai', () => ({
  atom: jest.fn(),
  useAtom: jest.fn(),
}))
jest.mock('@/containers/Toast', () => ({
  toaster: jest.fn(),
}))
jest.mock('@/helpers/atoms/Model.atom', () => ({
  configuredModelsAtom: jest.fn(),
  downloadedModelsAtom: jest.fn(),
  removeDownloadingModelAtom: jest.fn(),
}))

describe('setDownloadStateAtom', () => {
  let get: jest.Mock
  let set: jest.Mock

  beforeEach(() => {
    get = jest.fn()
    set = jest.fn()
  })

  it('should handle download completion', () => {
    const state = {
      downloadState: 'end',
      modelId: 'model1',
      fileName: 'file1',
      children: [],
    }
    const currentState = {
      model1: {
        children: [state],
      },
    }
    get.mockReturnValueOnce(currentState)
    get.mockReturnValueOnce([{ id: 'model1' }])

    set(setDownloadStateAtom, state)

    expect(set).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ modelId: expect.stringContaining('model1') })
    )
  })

  it('should handle download error', () => {
    const state = {
      downloadState: 'error',
      modelId: 'model1',
      error: 'some error',
    }
    const currentState = {
      model1: {},
    }
    get.mockReturnValueOnce(currentState)

    set(setDownloadStateAtom, state)

    expect(set).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ modelId: 'model1' })
    )
  })

  it('should handle download error with certificate issue', () => {
    const state = {
      downloadState: 'error',
      modelId: 'model1',
      error: 'certificate error',
    }
    const currentState = {
      model1: {},
    }
    get.mockReturnValueOnce(currentState)

    set(setDownloadStateAtom, state)

    expect(set).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ modelId: 'model1' })
    )
  })

  it('should handle download in progress', () => {
    const state = {
      downloadState: 'progress',
      modelId: 'model1',
      fileName: 'file1',
      size: { total: 100, transferred: 50 },
    }
    const currentState = {
      model1: {
        children: [],
        size: { total: 0, transferred: 0 },
      },
    }
    get.mockReturnValueOnce(currentState)

    set(setDownloadStateAtom, state)

    expect(set).toHaveBeenCalledWith(modelDownloadStateAtom, expect.any(Object))
  })
})
