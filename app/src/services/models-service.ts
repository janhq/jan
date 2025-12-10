import { fetchJsonWithAuth } from '@/lib/api-client'

declare const JAN_API_BASE_URL: string

export interface ModelsResponse {
  object: string
  data: Model[]
}

export const modelService = {
  getModels: async (): Promise<ModelsResponse> => {
    return fetchJsonWithAuth<ModelsResponse>(`${JAN_API_BASE_URL}v1/models`)
  },

  getModelDetail: async (modelId: string): Promise<ModelDetail> => {
    return fetchJsonWithAuth<ModelDetail>(
      `${JAN_API_BASE_URL}v1/models/catalogs/${modelId}`
    )
  },
}
