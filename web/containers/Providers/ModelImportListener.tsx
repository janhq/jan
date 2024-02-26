import { Fragment, PropsWithChildren, useCallback, useEffect } from 'react'

import {
  ImportingModel,
  LocalImportModelEvent,
  Model,
  ModelEvent,
  events,
} from '@janhq/core'
import { useSetAtom } from 'jotai'

import { snackbar } from '../Toast'

import {
  setImportingModelSuccessAtom,
  updateImportingModelProgressAtom,
} from '@/helpers/atoms/Model.atom'

const ModelImportListener = ({ children }: PropsWithChildren) => {
  const updateImportingModelProgress = useSetAtom(
    updateImportingModelProgressAtom
  )
  const setImportingModelSuccess = useSetAtom(setImportingModelSuccessAtom)

  const onImportModelUpdate = useCallback(
    async (state: ImportingModel) => {
      if (!state.importId) return
      updateImportingModelProgress(state.importId, state.percentage ?? 0)
    },
    [updateImportingModelProgress]
  )

  const onImportModelSuccess = useCallback(
    (state: ImportingModel) => {
      if (!state.modelId) return
      events.emit(ModelEvent.OnModelsUpdate, {})
      setImportingModelSuccess(state.importId, state.modelId)
    },
    [setImportingModelSuccess]
  )

  const onImportModelFinished = useCallback((importedModels: Model[]) => {
    const modelText = importedModels.length === 1 ? 'model' : 'models'
    snackbar({
      description: `Successfully imported ${importedModels.length} ${modelText}`,
      type: 'success',
    })
  }, [])

  useEffect(() => {
    console.debug('ModelImportListener: registering event listeners..')

    events.on(
      LocalImportModelEvent.onLocalImportModelUpdate,
      onImportModelUpdate
    )
    events.on(
      LocalImportModelEvent.onLocalImportModelSuccess,
      onImportModelSuccess
    )
    events.on(
      LocalImportModelEvent.onLocalImportModelFinished,
      onImportModelFinished
    )

    return () => {
      console.debug('ModelImportListener: unregistering event listeners...')
      events.off(
        LocalImportModelEvent.onLocalImportModelUpdate,
        onImportModelUpdate
      )
      events.off(
        LocalImportModelEvent.onLocalImportModelSuccess,
        onImportModelSuccess
      )
      events.off(
        LocalImportModelEvent.onLocalImportModelFinished,
        onImportModelFinished
      )
    }
  }, [onImportModelUpdate, onImportModelSuccess, onImportModelFinished])

  return <Fragment>{children}</Fragment>
}

export default ModelImportListener
