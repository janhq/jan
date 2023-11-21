import { useEffect, useState } from 'react'

import { PluginType } from '@janhq/core'
import { ModelPlugin } from '@janhq/core/lib/plugins'
import { ModelCatalog } from '@janhq/core/lib/types'

import { dummyModel } from '@/utils/dummy'

import { pluginManager } from '@/plugin/PluginManager'

export async function getConfiguredModels(): Promise<ModelCatalog[]> {
  return (
    pluginManager.get<ModelPlugin>(PluginType.Model)?.getConfiguredModels() ??
    []
  )
}

export function useGetConfiguredModels() {
  const [loading, setLoading] = useState<boolean>(false)
  const [models, setModels] = useState<ModelCatalog[]>([])

  async function getConfiguredModels(): Promise<ModelCatalog[]> {
    const models = await pluginManager
      .get<ModelPlugin>(PluginType.Model)
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
