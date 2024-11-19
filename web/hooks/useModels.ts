import { useCallback, useEffect } from 'react'

import {
  ExtensionTypeEnum,
  Model,
  ModelEvent,
  ModelExtension,
  events,
  ModelManager,
} from '@janhq/core'

import { useSetAtom, useAtom } from 'jotai'

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
  const [downloadedModels, setDownloadedModels] = useAtom(downloadedModelsAtom)
  const setExtensionModels = useSetAtom(configuredModelsAtom)

  const getData = useCallback(() => {
    const getDownloadedModels = async () => {
      const localModels = (await getModels()).map((e) => ({
        ...e,
        name: ModelManager.instance().models.get(e.id)?.name ?? e.name ?? e.id,
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

      let isUpdated = false

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
  }, [setDownloadedModels, setExtensionModels])

  const reloadData = useDebouncedCallback(() => getData(), 300)

  const updateStates = useCallback(() => {
    const cachedModels = ModelManager.instance().models.values().toArray()
    const toUpdate = [
      ...downloadedModels,
      ...cachedModels.filter(
        (e: Model) => !downloadedModels.some((g: Model) => g.id === e.id)
      ),
    ]

    setDownloadedModels(toUpdate)
  }, [downloadedModels, setDownloadedModels])

  const getModels = async (): Promise<Model[]> =>
    extensionManager
      .get<ModelExtension>(ExtensionTypeEnum.Model)
      ?.getModels()
      .catch(() => []) ?? []

  useEffect(() => {
    // Listen for model updates
    events.on(ModelEvent.OnModelsUpdate, async (data: { fetch?: boolean }) => {
      if (data.fetch) reloadData()
      else updateStates()
    })
    return () => {
      // Remove listener on unmount
      events.off(ModelEvent.OnModelsUpdate, async () => {})
    }
  }, [reloadData, updateStates])

  return {
    loadDataModel: getData,
  }
}

export default useModels
