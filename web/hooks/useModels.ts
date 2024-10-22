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
        name: ModelManager.instance().models.get(e.id)?.name ?? e.name,
        metadata:
          ModelManager.instance().models.get(e.id)?.metadata ?? e.metadata,
      }))

      const remoteModels = ModelManager.instance()
        .models.values()
        .toArray()
        .filter((e) => !isLocalEngine(e.engine))
      setDownloadedModels([...localModels, ...remoteModels])
    }

    const getExtensionModels = async () => {
      const models = ModelManager.instance().models.values().toArray()
      setExtensionModels(models)
    }

    // Fetch all data
    Promise.all([getDownloadedModels(), getExtensionModels()])
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
  }, [reloadData])
}

const getModels = async (): Promise<Model[]> =>
  extensionManager.get<ModelExtension>(ExtensionTypeEnum.Model)?.getModels() ??
  []

export default useModels
