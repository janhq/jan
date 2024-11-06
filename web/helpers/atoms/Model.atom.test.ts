import { act, renderHook } from '@testing-library/react'
import * as ModelAtoms from './Model.atom'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'

describe('Model.atom.ts', () => {
  let mockJotaiGet: jest.Mock
  let mockJotaiSet: jest.Mock

  beforeEach(() => {
    mockJotaiGet = jest.fn()
    mockJotaiSet = jest.fn()
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  describe('stateModel', () => {
    it('should initialize with correct default values', () => {
      expect(ModelAtoms.stateModel.init).toEqual({
        state: 'start',
        loading: false,
        model: '',
      })
    })
  })

  describe('selectedModelAtom', () => {
    it('should initialize as undefined', () => {
      expect(ModelAtoms.selectedModelAtom.init).toBeUndefined()
    })
  })

  describe('showEngineListModelAtom', () => {
    it('should initialize with local engines', () => {
      expect(ModelAtoms.showEngineListModelAtom.init).toEqual([
        'nitro',
        'cortex',
        'llama-cpp',
        'onnxruntime',
        'tensorrt-llm',
      ])
    })
  })

  describe('addDownloadingModelAtom', () => {
    it('should add downloading model', async () => {
      const { result: reset } = renderHook(() =>
        useSetAtom(ModelAtoms.downloadingModelsAtom)
      )
      const { result: setAtom } = renderHook(() =>
        useSetAtom(ModelAtoms.addDownloadingModelAtom)
      )
      const { result: getAtom } = renderHook(() =>
        useAtomValue(ModelAtoms.getDownloadingModelAtom)
      )
      act(() => {
        setAtom.current({ id: '1' } as any)
      })
      expect(getAtom.current).toEqual([{ id: '1' }])
      reset.current([])
    })
  })

  describe('removeDownloadingModelAtom', () => {
    it('should remove downloading model', async () => {
      const { result: reset } = renderHook(() =>
        useSetAtom(ModelAtoms.downloadingModelsAtom)
      )

      const { result: setAtom } = renderHook(() =>
        useSetAtom(ModelAtoms.addDownloadingModelAtom)
      )
      const { result: removeAtom } = renderHook(() =>
        useSetAtom(ModelAtoms.removeDownloadingModelAtom)
      )
      const { result: getAtom } = renderHook(() =>
        useAtomValue(ModelAtoms.getDownloadingModelAtom)
      )
      expect(getAtom.current).toEqual([])
      act(() => {
        setAtom.current('1')
        removeAtom.current('1')
      })
      expect(getAtom.current).toEqual([])
      reset.current([])
    })
  })

  describe('removeDownloadedModelAtom', () => {
    it('should remove downloaded model', async () => {
      const { result: reset } = renderHook(() =>
        useSetAtom(ModelAtoms.downloadingModelsAtom)
      )
      const { result: setAtom } = renderHook(() =>
        useSetAtom(ModelAtoms.downloadedModelsAtom)
      )
      const { result: removeAtom } = renderHook(() =>
        useSetAtom(ModelAtoms.removeDownloadedModelAtom)
      )
      const { result: getAtom } = renderHook(() =>
        useAtomValue(ModelAtoms.downloadedModelsAtom)
      )
      act(() => {
        setAtom.current([{ id: '1' }] as any)
      })
      expect(getAtom.current).toEqual([
        {
          id: '1',
        },
      ])
      act(() => {
        removeAtom.current('1')
      })
      expect(getAtom.current).toEqual([])
      reset.current([])
    })
  })

  describe('importingModelAtom', () => {
    afterEach(() => {
      jest.resetAllMocks()
      jest.clearAllMocks()
    })
    it('should not update for non-existing import', async () => {
      const { result: importAtom } = renderHook(() =>
        useAtom(ModelAtoms.importingModelsAtom)
      )
      const { result: updateAtom } = renderHook(() =>
        useSetAtom(ModelAtoms.updateImportingModelProgressAtom)
      )
      act(() => {
        importAtom.current[1]([])
        updateAtom.current('2', 50)
      })
      expect(importAtom.current[0]).toEqual([])
    })
    it('should update progress for existing import', async () => {
      const { result: importAtom } = renderHook(() =>
        useAtom(ModelAtoms.importingModelsAtom)
      )
      const { result: updateAtom } = renderHook(() =>
        useSetAtom(ModelAtoms.updateImportingModelProgressAtom)
      )

      act(() => {
        importAtom.current[1]([
          { importId: '1', status: 'MODEL_SELECTED' },
        ] as any)
        updateAtom.current('1', 50)
      })
      expect(importAtom.current[0]).toEqual([
        {
          importId: '1',
          status: 'IMPORTING',
          percentage: 50,
        },
      ])
    })

    it('should not update with invalid data', async () => {
      const { result: importAtom } = renderHook(() =>
        useAtom(ModelAtoms.importingModelsAtom)
      )
      const { result: updateAtom } = renderHook(() =>
        useSetAtom(ModelAtoms.updateImportingModelProgressAtom)
      )

      act(() => {
        importAtom.current[1]([
          { importId: '1', status: 'MODEL_SELECTED' },
        ] as any)
        updateAtom.current('2', 50)
      })
      expect(importAtom.current[0]).toEqual([
        {
          importId: '1',
          status: 'MODEL_SELECTED',
        },
      ])
    })
    it('should update import error', async () => {
      const { result: importAtom } = renderHook(() =>
        useAtom(ModelAtoms.importingModelsAtom)
      )
      const { result: errorAtom } = renderHook(() =>
        useSetAtom(ModelAtoms.setImportingModelErrorAtom)
      )
      act(() => {
        importAtom.current[1]([
          { importId: '1', status: 'IMPORTING', percentage: 50 },
        ] as any)
        errorAtom.current('1', 'unknown')
      })
      expect(importAtom.current[0]).toEqual([
        {
          importId: '1',
          status: 'FAILED',
          percentage: 50,
        },
      ])
    })
    it('should not update import error on invalid import ID', async () => {
      const { result: importAtom } = renderHook(() =>
        useAtom(ModelAtoms.importingModelsAtom)
      )
      const { result: errorAtom } = renderHook(() =>
        useSetAtom(ModelAtoms.setImportingModelErrorAtom)
      )
      act(() => {
        importAtom.current[1]([
          { importId: '1', status: 'IMPORTING', percentage: 50 },
        ] as any)
        errorAtom.current('2', 'unknown')
      })
      expect(importAtom.current[0]).toEqual([
        {
          importId: '1',
          status: 'IMPORTING',
          percentage: 50,
        },
      ])
    })

    it('should update import success', async () => {
      const { result: importAtom } = renderHook(() =>
        useAtom(ModelAtoms.importingModelsAtom)
      )
      const { result: successAtom } = renderHook(() =>
        useSetAtom(ModelAtoms.setImportingModelSuccessAtom)
      )

      act(() => {
        importAtom.current[1]([{ importId: '1', status: 'IMPORTING' }] as any)
        successAtom.current('1', 'id')
      })
      expect(importAtom.current[0]).toEqual([
        {
          importId: '1',
          status: 'IMPORTED',
          percentage: 1,
          modelId: 'id',
        },
      ])
    })

    it('should update with invalid import ID', async () => {
      const { result: importAtom } = renderHook(() =>
        useAtom(ModelAtoms.importingModelsAtom)
      )
      const { result: successAtom } = renderHook(() =>
        useSetAtom(ModelAtoms.setImportingModelSuccessAtom)
      )

      act(() => {
        importAtom.current[1]([{ importId: '1', status: 'IMPORTING' }] as any)
        successAtom.current('2', 'id')
      })
      expect(importAtom.current[0]).toEqual([
        {
          importId: '1',
          status: 'IMPORTING',
        },
      ])
    })
    it('should not update with valid data', async () => {
      const { result: importAtom } = renderHook(() =>
        useAtom(ModelAtoms.importingModelsAtom)
      )
      const { result: updateAtom } = renderHook(() =>
        useSetAtom(ModelAtoms.updateImportingModelAtom)
      )

      act(() => {
        importAtom.current[1]([
          { importId: '1', status: 'IMPORTING', percentage: 1 },
        ] as any)
        updateAtom.current('1', 'name', 'description', ['tag'])
      })
      expect(importAtom.current[0]).toEqual([
        {
          importId: '1',
          percentage: 1,
          status: 'IMPORTING',
          name: 'name',
          tags: ['tag'],
          description: 'description',
        },
      ])
    })

    it('should not update when there is no importing model', async () => {
      const { result: importAtom } = renderHook(() =>
        useAtom(ModelAtoms.importingModelsAtom)
      )
      const { result: updateAtom } = renderHook(() =>
        useSetAtom(ModelAtoms.updateImportingModelAtom)
      )

      act(() => {
        importAtom.current[1]([])
        updateAtom.current('1', 'name', 'description', ['tag'])
      })
      expect(importAtom.current[0]).toEqual([])
    })
  })
})
