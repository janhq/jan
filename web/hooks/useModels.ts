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
      const localModels = await getModels()
      const hubModels = ModelManager.instance().models.values().toArray()

      const remoteModels = hubModels.filter((e) => !isLocalEngine(e.engine))
      setDownloadedModels([...localModels, ...remoteModels])
    }

    const getExtensionModels = async () => {
      const models = ModelManager.instance().models.values().toArray()
      setExtensionModels(models)
    }

    // Fetch all data
    Promise.all([getDownloadedModels(), getExtensionModels()])
  }, [setDownloadedModels, setExtensionModels])

  useEffect(() => {
    // Try get data on mount
    getData()

    // Listen for model updates
    events.on(ModelEvent.OnModelsUpdate, async () => getData())
    return () => {
      // Remove listener on unmount
      events.off(ModelEvent.OnModelsUpdate, async () => {})
    }
  }, [getData])
}

const getModels = async (): Promise<Model[]> =>
  extensionManager.get<ModelExtension>(ExtensionTypeEnum.Model)?.getModels() ??
  []

export default useModels
