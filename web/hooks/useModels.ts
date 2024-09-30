import { useCallback, useEffect } from 'react'

import {
  ExtensionTypeEnum,
  Model,
  ModelEvent,
  ModelExtension,
  ModelFile,
  events,
} from '@janhq/core'

import { useSetAtom } from 'jotai'

import { extensionManager } from '@/extension'
import {
  configuredModelsAtom,
  defaultModelAtom,
  downloadedModelsAtom,
} from '@/helpers/atoms/Model.atom'

/**
 * useModels hook - Handles the state of models
 * It fetches the downloaded models, configured models and default model from Model Extension
 * and updates the atoms accordingly.
 */
const useModels = () => {
  const setDownloadedModels = useSetAtom(downloadedModelsAtom)
  const setConfiguredModels = useSetAtom(configuredModelsAtom)
  const setDefaultModel = useSetAtom(defaultModelAtom)

  const getData = useCallback(() => {
    const getDownloadedModels = async () => {
      const models = await getLocalDownloadedModels()
      setDownloadedModels(models)
    }

    const getConfiguredModels = async () => {
      const models = await getLocalConfiguredModels()
      setConfiguredModels(models)
    }

    const getDefaultModel = async () => {
      const defaultModel = await getLocalDefaultModel()
      setDefaultModel(defaultModel)
    }

    // Fetch all data
    Promise.all([
      getDownloadedModels(),
      getConfiguredModels(),
      getDefaultModel(),
    ])
  }, [setDownloadedModels, setConfiguredModels, setDefaultModel])

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

// TODO: Deprecated - Remove when moving to cortex.cpp
const getLocalDefaultModel = async (): Promise<Model | undefined> =>
  extensionManager
    .get<ModelExtension>(ExtensionTypeEnum.Model)
    ?.getDefaultModel()

// TODO: Deprecated - Remove when moving to cortex.cpp
const getLocalConfiguredModels = async (): Promise<ModelFile[]> =>
  extensionManager
    .get<ModelExtension>(ExtensionTypeEnum.Model)
    ?.getConfiguredModels() ?? []

// TODO: Deprecated - Remove when moving to cortex.cpp
const getLocalDownloadedModels = async (): Promise<ModelFile[]> =>
  extensionManager
    .get<ModelExtension>(ExtensionTypeEnum.Model)
    ?.getDownloadedModels() ?? []

export default useModels
