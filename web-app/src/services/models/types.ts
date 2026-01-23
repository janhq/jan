/**
 * Models Service Types
 */

import { SessionInfo, modelInfo, ThreadMessage, UnloadResult } from '@janhq/core'
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

export interface GgufMetadata {
  version: number
  tensor_count: number
  metadata: Record<string, string>
}

export interface ModelValidationResult {
  isValid: boolean
  error?: string
  metadata?: GgufMetadata
}

export interface ModelPlan {
  gpuLayers: number
  maxContextLength: number
  noOffloadKVCache: boolean
  offloadMmproj: boolean
  batchSize: number
  mode: 'GPU' | 'Hybrid' | 'CPU' | 'Unsupported'
}

export type PreflightReason =
  | 'AUTH_REQUIRED'
  | 'LICENSE_NOT_ACCEPTED'
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'NETWORK'
  | 'UNKNOWN'

export interface ModelsService {
  getModel(modelId: string): Promise<modelInfo | undefined>
  fetchModels(): Promise<modelInfo[]>
  fetchModelCatalog(): Promise<ModelCatalog>
  fetchHuggingFaceRepo(
    repoId: string,
    hfToken?: string
  ): Promise<HuggingFaceRepo | null>
  convertHfRepoToCatalogModel(repo: HuggingFaceRepo): CatalogModel
  updateModel(modelId: string, model: Partial<CoreModel>): Promise<void>
  pullModel(
    id: string,
    modelPath: string,
    modelSha256?: string,
    modelSize?: number,
    mmprojPath?: string,
    mmprojSha256?: string,
    mmprojSize?: number
  ): Promise<void>
  pullModelWithMetadata(
    id: string,
    modelPath: string,
    mmprojPath?: string,
    hfToken?: string,
    skipVerification?: boolean
  ): Promise<void>
  abortDownload(id: string): Promise<void>
  deleteModel(id: string): Promise<void>
  getActiveModels(provider?: string): Promise<string[]>
  stopModel(model: string, provider?: string): Promise<UnloadResult | undefined>
  stopAllModels(): Promise<void>
  startModel(
    provider: ProviderObject,
    model: string
  ): Promise<SessionInfo | undefined>
  isToolSupported(modelId: string): Promise<boolean>
  checkMmprojExistsAndUpdateOffloadMMprojSetting(
    modelId: string,
    updateProvider?: (
      providerName: string,
      data: Partial<ModelProvider>
    ) => void,
    getProviderByName?: (providerName: string) => ModelProvider | undefined
  ): Promise<{ exists: boolean; settingsUpdated: boolean }>
  checkMmprojExists(modelId: string): Promise<boolean>
  isModelSupported(
    modelPath: string,
    ctxSize?: number
  ): Promise<'RED' | 'YELLOW' | 'GREEN' | 'GREY'>
  validateGgufFile(filePath: string): Promise<ModelValidationResult>
  planModelLoad(
    modelPath: string,
    mmprojPath?: string,
    requestedCtx?: number
  ): Promise<ModelPlan>
  getTokensCount(modelId: string, messages: ThreadMessage[]): Promise<number>
}
