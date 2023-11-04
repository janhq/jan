import { useEffect, useState } from 'react'
import { ModelCatalog, ModelVersion } from '@janhq/core/lib/types'
import { pluginManager } from '@plugin/PluginManager'
import { ModelPlugin } from '@janhq/core/lib/plugins'
import { PluginType } from '@janhq/core'

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
      const dummyModel: ModelCatalog = {
        _id: 'TheBloke/TinyLlama-1.1B-Chat-v0.3-GGUF',
        name: 'TinyLlama-1.1B-Chat-v0.3-GGUF',
        shortDescription: 'TinyLlama-1.1B-Chat-v0.3-GGUF',
        longDescription:
          'https://huggingface.co/TheBloke/TinyLlama-1.1B-Chat-v0.3-GGUF/tree/main',
        avatarUrl: '',
        status: '',
        releaseDate: Date.now(),
        author: 'TheBloke',
        version: '1.0.0',
        modelUrl: 'TheBloke/TinyLlama-1.1B-Chat-v0.3-GGUF',
        tags: ['freeform', 'tags'],
        createdAt: 0,
        availableVersions: [
          {
            _id: 'tinyllama-1.1b-chat-v0.3.Q2_K.gguf',
            name: 'tinyllama-1.1b-chat-v0.3.Q2_K.gguf',
            quantMethod: '',
            bits: 2,
            size: 19660000,
            maxRamRequired: 256000000,
            usecase:
              'smallest, significant quality loss - not recommended for most purposes',
            downloadLink:
              // 'https://huggingface.co/TheBloke/TinyLlama-1.1B-Chat-v0.3-GGUF/resolve/main/tinyllama-1.1b-chat-v0.3.Q2_K.gguf',
              'https://huggingface.co/aladar/TinyLLama-v0-GGUF/resolve/main/TinyLLama-v0.f32.gguf',
          } as ModelVersion,
        ],
      }
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
