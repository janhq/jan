import { useEffect, useState } from 'react'
import { ModelCatalog } from '@janhq/core/lib/types'
import { pluginManager } from '@plugin/PluginManager'
import { ModelPlugin } from '@janhq/core/lib/plugins'
import { PluginType } from '@janhq/core'
import { dummyModel } from '@utils/dummy'

export default function useGetConfiguredModels() {
  const [loading, setLoading] = useState<boolean>(false)
  const [models, setModels] = useState<ModelCatalog[]>([])

  async function getConfiguredModels(): Promise<ModelCatalog[]> {
    return (
      ((await pluginManager
        .get<ModelPlugin>(PluginType.Model)
        ?.getConfiguredModels()) as ModelCatalog[]) ?? []
    )
  }

  const fetchModels = async () => {
    setLoading(true)
    let models = await getConfiguredModels()
    if (process.env.NODE_ENV === 'development') {
      models = [dummyModel, ...models]
    }
    setLoading(false)
    setModels(models)
  }

  // TODO allow user for filter
  useEffect(() => {
    fetchModels()
  }, [])

  return { loading, models }
}
