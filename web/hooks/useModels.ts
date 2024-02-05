import { useEffect } from 'react'

import { ExtensionTypeEnum, Model, ModelExtension } from '@janhq/core'

import { useSetAtom } from 'jotai'

import { extensionManager } from '@/extension'
import {
  configuredModelsAtom,
  downloadedModelsAtom,
} from '@/helpers/atoms/Model.atom'

const useModels = () => {
  const setDownloadedModels = useSetAtom(downloadedModelsAtom)
  const setConfiguredModels = useSetAtom(configuredModelsAtom)

  useEffect(() => {
    const getDownloadedModels = async () => {
      const models = await getLocalDownloadedModels()
      setDownloadedModels(models)
    }

    getDownloadedModels()
  }, [setDownloadedModels])

  useEffect(() => {
    const getConfiguredModels = async () => {
      const models = await getLocalConfiguredModels()
      setConfiguredModels(models)
    }

    getConfiguredModels()
  }, [setConfiguredModels])
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
