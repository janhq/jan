import { useCallback, useEffect, useRef } from 'react'

import {
  ExtensionTypeEnum,
  Model,
  ModelEvent,
  ModelExtension,
  events,
  ModelManager,
} from '@janhq/core'

import { useSetAtom } from 'jotai'

import { useDebouncedCallback } from 'use-debounce'

import { isLocalEngine } from '@/utils/modelEngine'

import { extensionManager } from '@/extension'
import {
  configuredModelsAtom,
  downloadedModelsAtom,
} from '@/helpers/atoms/Model.atom'

/**
 * useModels hook - Handles the state of models
 * It fetches the downloaded models, configured models and default model from Model Extension
 * and updates the atoms accordingly.
 */
const useModels = () => {
  const setDownloadedModels = useSetAtom(downloadedModelsAtom)
  const setExtensionModels = useSetAtom(configuredModelsAtom)
  const hasFetchedDownloadedModels = useRef(false) // Track whether the function has been executed

  let isUpdated = false

  const getData = useCallback(() => {
    if (hasFetchedDownloadedModels.current) return

    const getDownloadedModels = async () => {
      hasFetchedDownloadedModels.current = true
      const localModels = (await getModels()).map((e) => ({
        ...e,
        name: ModelManager.instance().models.get(e.id)?.name ?? e.id,
        metadata:
          ModelManager.instance().models.get(e.id)?.metadata ?? e.metadata,
      }))

      const remoteModels = ModelManager.instance()
        .models.values()
        .toArray()
        .filter((e) => !isLocalEngine(e.engine))
      const toUpdate = [
        ...localModels,
        ...remoteModels.filter(
          (e: Model) => !localModels.some((g: Model) => g.id === e.id)
        ),
      ]

      setDownloadedModels(toUpdate)

      toUpdate.forEach((model) => {
        if (!ModelManager.instance().models.has(model.id)) {
          ModelManager.instance().models.set(model.id, model)
          // eslint-disable-next-line react-hooks/exhaustive-deps
          isUpdated = true
        }
      })
      if (isUpdated) {
        getExtensionModels()
      }
    }

    const getExtensionModels = () => {
      const models = ModelManager.instance().models.values().toArray()
      setExtensionModels(models)
    }
    // Fetch all data
    getExtensionModels()
    getDownloadedModels()
  }, [])

  const reloadData = useDebouncedCallback(() => getData(), 300)

  const getModels = async (): Promise<Model[]> =>
    extensionManager
      .get<ModelExtension>(ExtensionTypeEnum.Model)
      ?.getModels() ?? []

  useEffect(() => {
    // Try get data on mount
    if (isUpdated) {
      // Listen for model updates
      events.on(ModelEvent.OnModelsUpdate, async () => reloadData())
      return () => {
        // Remove listener on unmount
        events.off(ModelEvent.OnModelsUpdate, async () => {})
      }
    }
  }, [isUpdated, reloadData])

  return {
    loadDataModel: getData,
    isUpdated: isUpdated,
  }
}

export default useModels
