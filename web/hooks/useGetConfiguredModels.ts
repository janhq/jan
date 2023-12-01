import { useEffect, useState } from 'react'

import { ExtensionType, ModelExtension } from '@janhq/core'
import { ModelCatalog } from '@janhq/core'

import { dummyModel } from '@/utils/dummy'

import { extensionManager } from '@/extension/ExtensionManager'

export async function getConfiguredModels(): Promise<ModelCatalog[]> {
  return (
    extensionManager
      .get<ModelExtension>(ExtensionType.Model)
      ?.getConfiguredModels() ?? []
  )
}

export function useGetConfiguredModels() {
  const [loading, setLoading] = useState<boolean>(false)
  const [models, setModels] = useState<ModelCatalog[]>([])

  async function getConfiguredModels(): Promise<ModelCatalog[]> {
    const models = await extensionManager
      .get<ModelExtension>(ExtensionType.Model)
      ?.getConfiguredModels()
    return models ?? []
  }

  async function fetchModels() {
    setLoading(true)
    let models = await getConfiguredModels()
    if (process.env.NODE_ENV === 'development') {
      models = [dummyModel, ...models]
    }
    setLoading(false)
    setModels(models)
  }

  useEffect(() => {
    fetchModels()
  }, [])

  return { loading, models }
}
