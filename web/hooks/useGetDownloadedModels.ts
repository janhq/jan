import { useEffect, useState } from 'react'
import { PluginType } from '@janhq/core'
import { ModelPlugin } from '@janhq/core/lib/plugins'
import { Model } from '@janhq/core/lib/types'
import { pluginManager } from '@/plugin/PluginManager'

export function useGetDownloadedModels() {
  const [downloadedModels, setDownloadedModels] = useState<Model[]>([])

  useEffect(() => {
    getDownloadedModels().then((downloadedModels) => {
      setDownloadedModels(downloadedModels)
    })
  }, [setDownloadedModels])

  return { downloadedModels, setDownloadedModels }
}

export async function getDownloadedModels(): Promise<Model[]> {
  const models = await pluginManager
    .get<ModelPlugin>(PluginType.Model)
    ?.getDownloadedModels()
  return models ?? []
}
