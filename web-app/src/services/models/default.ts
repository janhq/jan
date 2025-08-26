/* eslint-disable @typescript-eslint/no-unused-vars */
/**
 * Default Models Service - Web implementation
 */

import { sanitizeModelId } from '@/lib/utils'
import {
  AIEngine,
  EngineManager,
  SessionInfo,
} from '@janhq/core'
import { Model as CoreModel } from '@janhq/core'
import type { ModelsService, ModelCatalog, HuggingFaceRepo, CatalogModel } from './types'

// Model catalog URL
const MODEL_CATALOG_URL = 'https://raw.githubusercontent.com/menloresearch/cortex.llamacpp/main/models.json'

// TODO: Replace this with the actual provider later
const defaultProvider = 'llamacpp'

export class DefaultModelsService implements ModelsService {
  private getEngine(provider: string = defaultProvider) {
    return EngineManager.instance().get(provider) as AIEngine | undefined
  }

  async fetchModels(): Promise<CoreModel[] | undefined> {
    const modelInfos = await this.getEngine()?.list()
    // Convert modelInfo[] to CoreModel[] 
    return modelInfos?.map(modelInfo => ({
      ...modelInfo,
      // Add any missing CoreModel properties with defaults
      name: modelInfo.name || modelInfo.id,
      object: 'model',
      version: 1,
      format: 'gguf',
      sources: [],
      architecture: 'llama',
      metadata: {},
      size: modelInfo.sizeBytes || 0,
    } as unknown as CoreModel))
  }

  async fetchModelCatalog(): Promise<ModelCatalog> {
    try {
      const response = await fetch(MODEL_CATALOG_URL)

      if (!response.ok) {
        throw new Error(
          `Failed to fetch model catalog: ${response.status} ${response.statusText}`
        )
      }

      const catalog: ModelCatalog = await response.json()
      return catalog
    } catch (error) {
      console.error('Error fetching model catalog:', error)
      throw new Error(
        `Failed to fetch model catalog: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }

  async fetchHuggingFaceRepo(
    repoId: string,
    hfToken?: string
  ): Promise<HuggingFaceRepo | null> {
    try {
      // Clean the repo ID to handle various input formats
      const cleanRepoId = repoId
        .replace(/^https?:\/\/huggingface\.co\//, '')
        .replace(/^huggingface\.co\//, '')
        .replace(/\/$/, '') // Remove trailing slash
        .trim()

      if (!cleanRepoId || !cleanRepoId.includes('/')) {
        return null
      }

      const response = await fetch(
        `https://huggingface.co/api/models/${cleanRepoId}?blobs=true&files_metadata=true`,
        {
          headers: hfToken
            ? {
                Authorization: `Bearer ${hfToken}`,
              }
            : {},
        }
      )

      if (!response.ok) {
        if (response.status === 404) {
          return null // Repository not found
        }
        throw new Error(
          `Failed to fetch HuggingFace repository: ${response.status} ${response.statusText}`
        )
      }

      const repoData = await response.json()
      return repoData
    } catch (error) {
      console.error('Error fetching HuggingFace repository:', error)
      return null
    }
  }

  convertHfRepoToCatalogModel(repo: HuggingFaceRepo): CatalogModel | null {
    try {
      const ggufFiles =
        repo.siblings?.filter((file) => file.rfilename.endsWith('.gguf')) ?? []

      if (ggufFiles.length === 0) {
        return null // No GGUF files, not a compatible model
      }

      // Extract model name from repo ID (e.g., "TheBloke/Llama-2-7B-GGUF" -> "Llama-2-7B-GGUF")
      const modelName = repo.modelId.split('/').pop() ?? repo.modelId

      // Convert GGUF files to model quants
      const quants = ggufFiles.map((file) => ({
        model_id: sanitizeModelId(file.rfilename.replace('.gguf', '')),
        path: `https://huggingface.co/${repo.modelId}/resolve/main/${file.rfilename}`,
        file_size: file.lfs?.size
          ? `${(file.lfs.size / 1024 / 1024 / 1024).toFixed(2)} GB`
          : 'Unknown',
      }))

      // Check for vision/multimodal support
      const mmprojFiles =
        repo.siblings?.filter((file) => file.rfilename.includes('mmproj')) ?? []
      const mmproj_models = mmprojFiles.map((file) => ({
        model_id: sanitizeModelId(file.rfilename.replace('.gguf', '')),
        path: `https://huggingface.co/${repo.modelId}/resolve/main/${file.rfilename}`,
        file_size: file.lfs?.size
          ? `${(file.lfs.size / 1024 / 1024 / 1024).toFixed(2)} GB`
          : 'Unknown',
      }))

      const catalogModel: CatalogModel = {
        model_name: modelName,
        description: repo.cardData?.license
          ? `Licensed under ${repo.cardData.license}`
          : 'No description available',
        developer: repo.author,
        downloads: repo.downloads,
        num_quants: quants.length,
        quants,
        mmproj_models: mmproj_models.length > 0 ? mmproj_models : undefined,
        num_mmproj: mmproj_models.length,
        created_at: repo.createdAt,
        readme: repo.readme,
        tools: repo.tags?.includes('tool-use') || repo.tags?.includes('function-calling'),
      }

      return catalogModel
    } catch (error) {
      console.error('Error converting HuggingFace repo to catalog model:', error)
      return null
    }
  }

  async updateModel(model: CoreModel): Promise<CoreModel | undefined> {
    // AIEngine doesn't have an update method, so we return the model as-is
    // This might need to be handled differently based on the specific use case
    console.warn('updateModel called but AIEngine does not support update operation')
    return model
  }

  async pullModel(model: string, filePath?: string): Promise<void> {
    if (filePath) {
      await this.getEngine()?.import(model, { modelPath: filePath })
    } else {
      // For models without file path, we might need to handle differently
      console.warn('pullModel called without filePath, AIEngine requires import options')
    }
  }

  async pullModelWithMetadata(
    modelId: string,
    modelUrl: string,
    mmprojPath?: string,
    huggingfaceToken?: string
  ): Promise<void> {
    await this.getEngine()?.import(modelId, { 
      modelPath: modelUrl,
      mmprojPath: mmprojPath 
    })
  }

  async abortDownload(id: string): Promise<void> {
    await this.getEngine()?.abortImport(id)
  }

  async deleteModel(id: string): Promise<void> {
    await this.getEngine()?.delete(id)
  }

  async getActiveModels(provider?: string): Promise<CoreModel[]> {
    const engine = provider
      ? (EngineManager.instance().get(provider) as AIEngine | undefined)
      : this.getEngine()
    const modelIds = await engine?.getLoadedModels()
    // Convert model IDs to CoreModel objects
    // This is a simplified implementation - might need more complete model info
    return (modelIds ?? []).map(id => ({ id, name: id } as CoreModel))
  }

  async stopModel(model: string, provider?: string): Promise<void> {
    const engine = provider
      ? (EngineManager.instance().get(provider) as AIEngine | undefined)
      : this.getEngine()
    await engine?.unload(model)
  }

  async stopAllModels(): Promise<void> {
    for (const [, value] of EngineManager.instance().engines) {
      if ('stopAllModels' in value && typeof value.stopAllModels === 'function') {
        await (value as { stopAllModels: () => Promise<void> }).stopAllModels()
      }
    }
  }

  async startModel(id: string, provider?: string): Promise<SessionInfo | undefined> {
    const engine = provider
      ? (EngineManager.instance().get(provider) as AIEngine | undefined)
      : this.getEngine()
    return engine?.load(id)
  }

  async isToolSupported(modelId: string): Promise<boolean> {
    const models = await this.fetchModels()
    const model = models?.find((e) => e.id === modelId)
    if (!model) return false
    const settings = model.settings as unknown as Record<string, unknown>
    if (settings && typeof settings === 'object') {
      return 'tool_choice' in settings
    }
    return false
  }

  async checkMmprojExistsAndUpdateOffloadMMprojSetting(
    modelId: string,
    updateProvider?: (providerName: string, data: Partial<ModelProvider>) => void,
    getProviderByName?: (providerName: string) => ModelProvider | undefined
  ): Promise<{ exists: boolean; settingsUpdated: boolean }> {
    let settingsUpdated = false

    try {
      const engine = this.getEngine('llamacpp') as AIEngine & {
        checkMmprojExists?: (id: string) => Promise<boolean>
      }
      if (engine && typeof engine.checkMmprojExists === 'function') {
        const exists = await engine.checkMmprojExists(modelId)

        // If we have the store functions, use them; otherwise fall back to localStorage
        if (updateProvider && getProviderByName) {
          const provider = getProviderByName('llamacpp')
          if (provider) {
            const model = provider.models.find((m) => m.id === modelId)

            if (model?.settings) {
              const hasOffloadMmproj = 'offload_mmproj' in model.settings

              // If mmproj exists, add offload_mmproj setting (only if it doesn't exist)
              if (exists && !hasOffloadMmproj) {
                // Create updated models array with the new setting
                const updatedModels = provider.models.map((m) => {
                  if (m.id === modelId) {
                    return {
                      ...m,
                      settings: {
                        ...m.settings,
                        offload_mmproj: {
                          key: 'offload_mmproj',
                          title: 'Offload MMProj',
                          description: 'Offload multimodal projection model to GPU',
                          controller_type: 'checkbox',
                          controller_props: {
                            value: true,
                          },
                        },
                      },
                    }
                  }
                  return m
                })

                // Update the provider with the new models array
                updateProvider('llamacpp', { models: updatedModels })
                settingsUpdated = true
              }
            }
          }
        } else {
          // Fall back to localStorage approach for backwards compatibility
          try {
            const modelProviderData = JSON.parse(
              localStorage.getItem('model-provider') || '{}'
            )
            const llamacppProvider = modelProviderData.state?.providers?.find(
              (p: { provider: string }) => p.provider === 'llamacpp'
            )
            const model = llamacppProvider?.models?.find(
              (m: { id: string; settings?: Record<string, unknown> }) => m.id === modelId
            )

            if (model?.settings) {
              // If mmproj exists, add offload_mmproj setting (only if it doesn't exist)
              if (exists) {
                if (!model.settings.offload_mmproj) {
                  model.settings.offload_mmproj = {
                    key: 'offload_mmproj',
                    title: 'Offload MMProj',
                    description: 'Offload multimodal projection model to GPU',
                    controller_type: 'checkbox',
                    controller_props: {
                      value: true,
                    },
                  }
                  // Save updated settings back to localStorage
                  localStorage.setItem(
                    'model-provider',
                    JSON.stringify(modelProviderData)
                  )
                  settingsUpdated = true
                }
              }
            }
          } catch (localStorageError) {
            console.error(
              `Error checking localStorage for model ${modelId}:`,
              localStorageError
            )
          }
        }

        return { exists, settingsUpdated }
      }
    } catch (error) {
      console.error(`Error checking mmproj for model ${modelId}:`, error)
    }
    return { exists: false, settingsUpdated }
  }

  async checkMmprojExists(modelId: string): Promise<boolean> {
    // AIEngine doesn't have checkMmprojExists method
    // This might be a legacy method or extension-specific
    // For now, return false as a safe default
    console.warn('checkMmprojExists called but AIEngine does not support this operation')
    return false
  }

  async isModelSupported(modelPath: string, ctxSize?: number): Promise<'RED' | 'YELLOW' | 'GREEN'> {
    try {
      const engine = this.getEngine('llamacpp') as AIEngine & {
        isModelSupported?: (
          path: string,
          ctx_size?: number
        ) => Promise<'RED' | 'YELLOW' | 'GREEN'>
      }
      if (engine && typeof engine.isModelSupported === 'function') {
        return await engine.isModelSupported(modelPath, ctxSize)
      }
      // Fallback if method is not available
      console.warn('isModelSupported method not available in llamacpp engine')
      return 'YELLOW' // Conservative fallback
    } catch (error) {
      console.error(`Error checking model support for ${modelPath}:`, error)
      return 'RED' // Error state, assume not supported
    }
  }
}