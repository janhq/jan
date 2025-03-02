import { useCallback, useEffect } from 'react'

import React from 'react'

import {
  DownloadEvent,
  DownloadState,
  events,
  ModelEvent,
  ExtensionTypeEnum,
  ModelExtension,
  ModelManager,
  Model,
} from '@janhq/core'

import { useSetAtom } from 'jotai'

import { setDownloadStateAtom } from '@/hooks/useDownloadState'

import { toaster } from '../Toast'

import AppUpdateListener from './AppUpdateListener'
import ClipboardListener from './ClipboardListener'
import ModelHandler from './ModelHandler'

import QuickAskListener from './QuickAskListener'

import { extensionManager } from '@/extension'
import {
  addDownloadingModelAtom,
  removeDownloadingModelAtom,
} from '@/helpers/atoms/Model.atom'

const EventListener = () => {
  const setDownloadState = useSetAtom(setDownloadStateAtom)
  const addDownloadingModel = useSetAtom(addDownloadingModelAtom)
  const removeDownloadingModel = useSetAtom(removeDownloadingModelAtom)

  const onFileDownloadUpdate = useCallback(
    async (state: DownloadState) => {
      console.debug('onFileDownloadUpdate', state)
      addDownloadingModel(state.modelId)
      setDownloadState(state)
    },
    [addDownloadingModel, setDownloadState]
  )

  const onFileDownloadError = useCallback(
    (state: DownloadState) => {
      console.debug('onFileDownloadError', state)
      state.downloadState = 'error'
      setDownloadState(state)
      removeDownloadingModel(state.modelId)
    },
    [setDownloadState, removeDownloadingModel]
  )

  const onFileDownloadStopped = useCallback(
    (state: DownloadState) => {
      console.debug('onFileDownloadError', state)

      state.downloadState = 'error'
      state.error = 'aborted'
      setDownloadState(state)
      removeDownloadingModel(state.modelId)
    },
    [setDownloadState, removeDownloadingModel]
  )

  const onFileDownloadSuccess = useCallback(
    async (state: DownloadState) => {
      console.debug('onFileDownloadSuccess', state)

      // Update model metadata accordingly
      const model = ModelManager.instance().models.get(state.modelId)
      if (model) {
        await extensionManager
          .get<ModelExtension>(ExtensionTypeEnum.Model)
          ?.updateModel({
            id: model.id,
            ...model.settings,
            ...model.parameters,
          } as Partial<Model>)
          .catch((e) => console.debug(e))

        toaster({
          title: 'Download Completed',
          description: `Download ${state.modelId} completed`,
          type: 'success',
        })
      }
      state.downloadState = 'end'
      setDownloadState(state)
      removeDownloadingModel(state.modelId)
      events.emit(ModelEvent.OnModelsUpdate, { fetch: true })
    },
    [removeDownloadingModel, setDownloadState]
  )

  useEffect(() => {
    console.debug('EventListenerWrapper: registering event listeners...')
    events.on(DownloadEvent.onFileDownloadUpdate, onFileDownloadUpdate)
    events.on(DownloadEvent.onFileDownloadError, onFileDownloadError)
    events.on(DownloadEvent.onFileDownloadSuccess, onFileDownloadSuccess)
    events.on(DownloadEvent.onFileDownloadStopped, onFileDownloadStopped)

    return () => {
      console.debug('EventListenerWrapper: unregistering event listeners...')
      events.off(DownloadEvent.onFileDownloadUpdate, onFileDownloadUpdate)
      events.off(DownloadEvent.onFileDownloadError, onFileDownloadError)
      events.off(DownloadEvent.onFileDownloadSuccess, onFileDownloadSuccess)
      events.off(DownloadEvent.onFileDownloadStopped, onFileDownloadStopped)
    }
  }, [
    onFileDownloadUpdate,
    onFileDownloadError,
    onFileDownloadSuccess,
    onFileDownloadStopped,
  ])

  return (
    <>
      <AppUpdateListener />
      <ClipboardListener />
      <QuickAskListener />
      <ModelHandler />
    </>
  )
}

export default EventListener
