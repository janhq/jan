import { useCallback, useEffect } from 'react'

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

  const getData = useCallback(() => {
    const getDownloadedModels = async () => {
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
      const toUpdate = [...localModels, ...remoteModels]
      setDownloadedModels(toUpdate)

      let isUpdated = false
      toUpdate.forEach((model) => {
        if (!ModelManager.instance().models.has(model.id)) {
          ModelManager.instance().models.set(model.id, model)
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
  }, [setDownloadedModels, setExtensionModels])

  const reloadData = useDebouncedCallback(() => getData(), 300)

  useEffect(() => {
    // Try get data on mount
    reloadData()

    // Listen for model updates
    events.on(ModelEvent.OnModelsUpdate, async () => reloadData())
    return () => {
      // Remove listener on unmount
      events.off(ModelEvent.OnModelsUpdate, async () => {})
    }
  }, [getData, reloadData])
}

const getModels = async (): Promise<Model[]> =>
  extensionManager.get<ModelExtension>(ExtensionTypeEnum.Model)?.getModels() ??
  []

export default useModels
