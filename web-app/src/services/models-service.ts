import { fetchJsonWithAuth } from '@/lib/api-client'
import { EngineManager } from '@janhq/core'

declare const JAN_API_BASE_URL: string

export interface ModelsResponse {
  object: string
  data: Model[]
}

export interface ModelProvider {
  getModels(): Promise<ModelsResponse>
  getModelDetail(modelId: string): Promise<ModelDetail>
}

class CloudModelProvider implements ModelProvider {
  async getModels(): Promise<ModelsResponse> {
    return fetchJsonWithAuth<ModelsResponse>(`${JAN_API_BASE_URL}v1/models`)
  }

  async getModelDetail(modelId: string): Promise<ModelDetail> {
    return fetchJsonWithAuth<ModelDetail>(
      `${JAN_API_BASE_URL}v1/models/catalogs/${modelId}`
    )
  }
}

class LocalModelProvider implements ModelProvider {
  async getModels(): Promise<ModelsResponse> {
    const llamaCpp = EngineManager.instance().get('llamacpp')
    const models = (await llamaCpp?.list()) ?? []
    return { object: 'list', data: models }
  }

  async getModelDetail(_modelId: string): Promise<ModelDetail> {
    throw new Error('Local model details not implemented')
  }
}

export const modelProviderFactory = (
  source: 'cloud' | 'local' = 'cloud'
): ModelProvider => {
  if (source === 'cloud') {
    return new CloudModelProvider()
  }
  return new LocalModelProvider()
}

export const modelService = {
  /**
   * Get models from a specific source or all sources
   * @param source - 'cloud', 'local', or 'all' to fetch from both
   */
  getModels: async (
    source: 'cloud' | 'local' | 'all' = 'all'
  ): Promise<ModelsResponse> => {
    if (source === 'all') {
      const [localModels, cloudModels] = await Promise.all([
        modelProviderFactory('local').getModels(),
        modelProviderFactory('cloud').getModels(),
      ])
      return {
        object: 'list',
        data: [...localModels.data, ...cloudModels.data],
      }
    }

    return modelProviderFactory(source).getModels()
  },

  getModelDetail: async (
    modelId: string,
    source: 'cloud' | 'local' = 'cloud'
  ): Promise<ModelDetail> => {
    return modelProviderFactory(source).getModelDetail(modelId)
  },
}
