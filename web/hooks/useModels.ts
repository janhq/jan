import { useCallback, useEffect } from 'react'

import {
  ExtensionTypeEnum,
  Model,
  ModelEvent,
  ModelExtension,
  events,
} from '@janhq/core'

import { useSetAtom } from 'jotai'

import useCortex from './useCortex'

import { extensionManager } from '@/extension'
import {
  configuredModelsAtom,
  defaultModelAtom,
  downloadedModelsAtom,
} from '@/helpers/atoms/Model.atom'

const useModels = () => {
  const setDownloadedModels = useSetAtom(downloadedModelsAtom)
  const setConfiguredModels = useSetAtom(configuredModelsAtom)
  const setDefaultModel = useSetAtom(defaultModelAtom)
  const { fetchModels } = useCortex()

  const getData = useCallback(() => {
    const getDownloadedModels = async () => {
      const models = await fetchModels()
      setDownloadedModels(models)
    }

    const getConfiguredModels = async () => {
      const models = await fetchModels()
      setConfiguredModels(models)
    }

    // namh: this can be removed in the future
    const getDefaultModel = async () => {
      const defaultModel = await getLocalDefaultModel()
      setDefaultModel(defaultModel)
    }

    Promise.all([
      getDownloadedModels(),
      getConfiguredModels(),
      getDefaultModel(),
    ])
  }, [setDownloadedModels, setConfiguredModels, setDefaultModel, fetchModels])

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

const getLocalDefaultModel = async (): Promise<Model | undefined> =>
  extensionManager
    .get<ModelExtension>(ExtensionTypeEnum.Model)
    ?.getDefaultModel()

export default useModels
