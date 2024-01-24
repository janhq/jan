import { useEffect, useState } from 'react'

import { ExtensionTypeEnum, ModelExtension, Model } from '@janhq/core'

import { extensionManager } from '@/extension/ExtensionManager'

export function useGetConfiguredModels() {
  const [loading, setLoading] = useState<boolean>(false)
  const [models, setModels] = useState<Model[]>([])

  const getConfiguredModels = async (): Promise<Model[]> => {
    const models = await extensionManager
      .get<ModelExtension>(ExtensionTypeEnum.Model)
      ?.getConfiguredModels()
    return models ?? []
  }

  async function fetchModels() {
    setLoading(true)
    const models = await getConfiguredModels()
    setLoading(false)
    setModels(models)
  }

  useEffect(() => {
    fetchModels()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { loading, models }
}
