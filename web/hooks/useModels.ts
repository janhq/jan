import { useCallback, useEffect } from 'react'

import {
  ExtensionTypeEnum,
  Model,
  ModelEvent,
  ModelExtension,
  events,
} from '@janhq/core'

import { useSetAtom } from 'jotai'

import { extensionManager } from '@/extension'
import {
  configuredModelsAtom,
  downloadedModelsAtom,
} from '@/helpers/atoms/Model.atom'

const useModels = () => {
  const setDownloadedModels = useSetAtom(downloadedModelsAtom)
  const setConfiguredModels = useSetAtom(configuredModelsAtom)

  const getData = useCallback(() => {
    const getDownloadedModels = async () => {
      const models = await getLocalDownloadedModels()
      setDownloadedModels(models)
    }
    const getConfiguredModels = async () => {
      const models = await getLocalConfiguredModels()
      setConfiguredModels(models)
    }
    getDownloadedModels()
    getConfiguredModels()
  }, [setDownloadedModels, setConfiguredModels])

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

const getLocalConfiguredModels = async (): Promise<Model[]> =>
  extensionManager
    .get<ModelExtension>(ExtensionTypeEnum.Model)
    ?.getConfiguredModels() ?? []

const getLocalDownloadedModels = async (): Promise<Model[]> =>
  extensionManager
    .get<ModelExtension>(ExtensionTypeEnum.Model)
    ?.getDownloadedModels() ?? []

export default useModels
