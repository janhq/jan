import { useEffect, useState } from 'react'

import { ExtensionType, ModelExtension } from '@janhq/core'
import { Model } from '@janhq/core'

import { extensionManager } from '@/extension/ExtensionManager'

export function useGetConfiguredModels() {
  const [loading, setLoading] = useState<boolean>(false)
  const [models, setModels] = useState<Model[]>([])

  const getConfiguredModels = async (): Promise<Model[]> => {
    const models = await extensionManager
      .get<ModelExtension>(ExtensionType.Model)
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
  }, [])

  return { loading, models }
}
