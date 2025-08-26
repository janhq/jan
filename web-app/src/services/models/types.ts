/**
 * Models Service Types
 */

import { SessionInfo } from '@janhq/core'
import { Model as CoreModel } from '@janhq/core'

// Types for model catalog
export interface ModelQuant {
  model_id: string
  path: string
  file_size: string
}

export interface MMProjModel {
  model_id: string
  path: string
  file_size: string
}

export interface CatalogModel {
  model_name: string
  description: string
  developer: string
  downloads: number
  num_quants: number
  quants: ModelQuant[]
  mmproj_models?: MMProjModel[]
  num_mmproj: number
  created_at?: string
  readme?: string
  tools?: boolean
}

export type ModelCatalog = CatalogModel[]

// HuggingFace repository information
export interface HuggingFaceRepo {
  id: string
  modelId: string
  sha: string
  downloads: number
  likes: number
  library_name?: string
  tags: string[]
  pipeline_tag?: string
  createdAt: string
  last_modified: string
  private: boolean
  disabled: boolean
  gated: boolean | string
  author: string
  cardData?: {
    license?: string
    language?: string[]
    datasets?: string[]
    metrics?: string[]
  }
  siblings?: Array<{
    rfilename: string
    size?: number
    blobId?: string
    lfs?: {
      sha256: string
      size: number
      pointerSize: number
    }
  }>
  readme?: string
}

export interface ModelsService {
  fetchModels(): Promise<CoreModel[] | undefined>
  fetchModelCatalog(): Promise<ModelCatalog>
  fetchHuggingFaceRepo(repoId: string, hfToken?: string): Promise<HuggingFaceRepo | null>
  convertHfRepoToCatalogModel(repo: HuggingFaceRepo): CatalogModel | null
  updateModel(model: CoreModel): Promise<CoreModel | undefined>
  pullModel(model: string, filePath?: string): Promise<void>
  pullModelWithMetadata(
    modelId: string,
    modelUrl: string,
    mmprojPath?: string,
    huggingfaceToken?: string
  ): Promise<void>
  abortDownload(id: string): Promise<void>
  deleteModel(id: string): Promise<void>
  getActiveModels(provider?: string): Promise<CoreModel[]>
  stopModel(model: string, provider?: string): Promise<void>
  stopAllModels(): Promise<void>
  startModel(id: string, provider?: string): Promise<SessionInfo | undefined>
  isToolSupported(modelId: string): Promise<boolean>
  checkMmprojExistsAndUpdateOffloadMMprojSetting(
    modelId: string,
    updateProvider?: (providerName: string, data: Partial<ModelProvider>) => void,
    getProviderByName?: (providerName: string) => ModelProvider | undefined
  ): Promise<{ exists: boolean; settingsUpdated: boolean }>
  checkMmprojExists(modelId: string): Promise<boolean>
  isModelSupported(modelPath: string, ctxSize?: number): Promise<'RED' | 'YELLOW' | 'GREEN'>
}