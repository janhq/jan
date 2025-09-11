/**
 * Default Models Service - Web implementation
 */

import { sanitizeModelId } from '@/lib/utils'
import {
  AIEngine,
  EngineManager,
  SessionInfo,
  SettingComponentProps,
  modelInfo,
} from '@janhq/core'
import { Model as CoreModel } from '@janhq/core'
import type {
  ModelsService,
  ModelCatalog,
  HuggingFaceRepo,
  CatalogModel,
  ModelValidationResult,
  ModelPlan,
} from './types'

// TODO: Replace this with the actual provider later
const defaultProvider = 'llamacpp'

export class DefaultModelsService implements ModelsService {
  private getEngine(provider: string = defaultProvider) {
    return EngineManager.instance().get(provider) as AIEngine | undefined
  }

  async fetchModels(): Promise<modelInfo[]> {
    return this.getEngine()?.list() ?? []
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

  convertHfRepoToCatalogModel(repo: HuggingFaceRepo): CatalogModel {
    // Format file size helper
    const formatFileSize = (size?: number) => {
      if (!size) return 'Unknown size'
      if (size < 1024 ** 3) return `${(size / 1024 ** 2).toFixed(1)} MB`
      return `${(size / 1024 ** 3).toFixed(1)} GB`
    }

    // Extract GGUF files from the repository siblings
    const ggufFiles =
      repo.siblings?.filter((file) =>
        file.rfilename.toLowerCase().endsWith('.gguf')
      ) || []

    // Separate regular GGUF files from mmproj files
    const regularGgufFiles = ggufFiles.filter(
      (file) => !file.rfilename.toLowerCase().includes('mmproj')
    )

    const mmprojFiles = ggufFiles.filter((file) =>
      file.rfilename.toLowerCase().includes('mmproj')
    )

    // Convert regular GGUF files to quants format
    const quants = regularGgufFiles.map((file) => {
      // Generate model_id from filename (remove .gguf extension, case-insensitive)
      const modelId = file.rfilename.replace(/\.gguf$/i, '')

      return {
        model_id: sanitizeModelId(modelId),
        path: `https://huggingface.co/${repo.modelId}/resolve/main/${file.rfilename}`,
        file_size: formatFileSize(file.size),
      }
    })

    // Convert mmproj files to mmproj_models format
    const mmprojModels = mmprojFiles.map((file) => {
      const modelId = file.rfilename.replace(/\.gguf$/i, '')

      return {
        model_id: sanitizeModelId(modelId),
        path: `https://huggingface.co/${repo.modelId}/resolve/main/${file.rfilename}`,
        file_size: formatFileSize(file.size),
      }
    })

    return {
      model_name: repo.modelId,
      developer: repo.author,
      downloads: repo.downloads || 0,
      created_at: repo.createdAt,
      num_quants: quants.length,
      quants: quants,
      num_mmproj: mmprojModels.length,
      mmproj_models: mmprojModels,
      readme: `https://huggingface.co/${repo.modelId}/resolve/main/README.md`,
      description: `**Tags**: ${repo.tags?.join(', ')}`,
    }
  }

  async updateModel(model: Partial<CoreModel>): Promise<void> {
    if (model.settings)
      this.getEngine()?.updateSettings(
        model.settings as SettingComponentProps[]
      )
  }

  async pullModel(
    id: string,
    modelPath: string,
    modelSha256?: string,
    modelSize?: number,
    mmprojPath?: string,
    mmprojSha256?: string,
    mmprojSize?: number
  ): Promise<void> {
    return this.getEngine()?.import(id, {
      modelPath,
      mmprojPath,
      modelSha256,
      modelSize,
      mmprojSha256,
      mmprojSize,
    })
  }

  async pullModelWithMetadata(
    id: string,
    modelPath: string,
    mmprojPath?: string,
    hfToken?: string
  ): Promise<void> {
    let modelSha256: string | undefined
    let modelSize: number | undefined
    let mmprojSha256: string | undefined
    let mmprojSize: number | undefined

    // Extract repo ID from model URL
    // URL format: https://huggingface.co/{repo}/resolve/main/{filename}
    const modelUrlMatch = modelPath.match(
      /https:\/\/huggingface\.co\/([^/]+\/[^/]+)\/resolve\/main\/(.+)/
    )

    if (modelUrlMatch) {
      const [, repoId, modelFilename] = modelUrlMatch

      try {
        // Fetch real-time metadata from HuggingFace
        const repoInfo = await this.fetchHuggingFaceRepo(repoId, hfToken)

        if (repoInfo?.siblings) {
          // Find the specific model file
          const modelFile = repoInfo.siblings.find(
            (file) => file.rfilename === modelFilename
          )
          if (modelFile?.lfs) {
            modelSha256 = modelFile.lfs.sha256
            modelSize = modelFile.lfs.size
          }

          // If mmproj path provided, extract its metadata too
          if (mmprojPath) {
            const mmprojUrlMatch = mmprojPath.match(
              /https:\/\/huggingface\.co\/[^/]+\/[^/]+\/resolve\/main\/(.+)/
            )
            if (mmprojUrlMatch) {
              const [, mmprojFilename] = mmprojUrlMatch
              const mmprojFile = repoInfo.siblings.find(
                (file) => file.rfilename === mmprojFilename
              )
              if (mmprojFile?.lfs) {
                mmprojSha256 = mmprojFile.lfs.sha256
                mmprojSize = mmprojFile.lfs.size
              }
            }
          }
        }
      } catch (error) {
        console.warn(
          'Failed to fetch HuggingFace metadata, proceeding without hash verification:',
          error
        )
        // Continue with download even if metadata fetch fails
      }
    }

    // Call the original pullModel with the fetched metadata
    return this.pullModel(
      id,
      modelPath,
      modelSha256,
      modelSize,
      mmprojPath,
      mmprojSha256,
      mmprojSize
    )
  }

  async abortDownload(id: string): Promise<void> {
    return this.getEngine()?.abortImport(id)
  }

  async deleteModel(id: string): Promise<void> {
    return this.getEngine()?.delete(id)
  }

  async getActiveModels(provider?: string): Promise<string[]> {
    return this.getEngine(provider)?.getLoadedModels() ?? []
  }

  async stopModel(model: string, provider?: string): Promise<void> {
    this.getEngine(provider)?.unload(model)
  }

  async stopAllModels(): Promise<void> {
    const models = await this.getActiveModels()
    if (models) await Promise.all(models.map((model) => this.stopModel(model)))
  }

  async startModel(
    provider: ProviderObject,
    model: string
  ): Promise<SessionInfo | undefined> {
    const engine = this.getEngine(provider.provider)
    if (!engine) return undefined

    const loadedModels = await engine.getLoadedModels()
    if (loadedModels.includes(model)) return undefined

    // Find the model configuration to get settings
    const modelConfig = provider.models.find((m) => m.id === model)

    // Key mapping function to transform setting keys
    const mapSettingKey = (key: string): string => {
      const keyMappings: Record<string, string> = {
        ctx_len: 'ctx_size',
        ngl: 'n_gpu_layers',
      }
      return keyMappings[key] || key
    }

    const settings = modelConfig?.settings
      ? Object.fromEntries(
          Object.entries(modelConfig.settings).map(([key, value]) => [
            mapSettingKey(key),
            value.controller_props?.value,
          ])
        )
      : undefined

    return engine.load(model, settings).catch((error) => {
      console.error(
        `Failed to start model ${model} for provider ${provider.provider}:`,
        error
      )
      throw error
    })
  }

  async isToolSupported(modelId: string): Promise<boolean> {
    const engine = this.getEngine()
    if (!engine) return false

    return engine.isToolSupported(modelId)
  }

  async checkMmprojExistsAndUpdateOffloadMMprojSetting(
    modelId: string,
    updateProvider?: (
      providerName: string,
      data: Partial<ModelProvider>
    ) => void,
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
                          description:
                            'Offload multimodal projection model to GPU',
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
              (m: { id: string; settings?: Record<string, unknown> }) =>
                m.id === modelId
            )

            if (model?.settings) {
              // If mmproj exists, add offload_mmproj setting (only if it doesn't exist)
              if (exists) {
                if (!model.settings.offload_mmproj) {
                  model.settings.offload_mmproj = {
                    key: 'offload_mmproj',
                    title: 'Offload MMProj',
                    description: 'Offload multimodal projection layers to GPU',
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
    try {
      const engine = this.getEngine('llamacpp') as AIEngine & {
        checkMmprojExists?: (id: string) => Promise<boolean>
      }
      if (engine && typeof engine.checkMmprojExists === 'function') {
        return await engine.checkMmprojExists(modelId)
      }
    } catch (error) {
      console.error(`Error checking mmproj for model ${modelId}:`, error)
    }
    return false
  }

  async isModelSupported(
    modelPath: string,
    ctxSize?: number
  ): Promise<'RED' | 'YELLOW' | 'GREEN' | 'GREY'> {
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
      return 'GREY' // Error state, assume not supported
    }
  }

  async validateGgufFile(filePath: string): Promise<ModelValidationResult> {
    try {
      const engine = this.getEngine('llamacpp') as AIEngine & {
        validateGgufFile?: (path: string) => Promise<ModelValidationResult>
      }

      if (engine && typeof engine.validateGgufFile === 'function') {
        return await engine.validateGgufFile(filePath)
      }

      // If the specific method isn't available, we can fallback to a basic check
      console.warn('validateGgufFile method not available in llamacpp engine')
      return {
        isValid: true, // Assume valid for now
        error: 'Validation method not available',
      }
    } catch (error) {
      console.error(`Error validating GGUF file ${filePath}:`, error)
      return {
        isValid: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  async planModelLoad(
    modelPath: string,
    mmprojPath?: string,
    requestedCtx?: number
  ): Promise<ModelPlan> {
    try {
      const engine = this.getEngine('llamacpp') as AIEngine & {
        planModelLoad?: (
          path: string,
          mmprojPath?: string,
          requestedCtx?: number
        ) => Promise<ModelPlan>
      }

      if (engine && typeof engine.planModelLoad === 'function') {
        // Get the full absolute path to the model file
        const janDataFolderPath = await import('@janhq/core').then((core) =>
          core.getJanDataFolderPath()
        )
        const joinPath = await import('@janhq/core').then(
          (core) => core.joinPath
        )
        const fullModelPath = await joinPath([janDataFolderPath, modelPath])
        // mmprojPath is currently unused, but included for compatibility
        return await engine.planModelLoad(
          fullModelPath,
          mmprojPath,
          requestedCtx
        )
      }

      // Fallback if method is not available
      console.warn('planModelLoad method not available in llamacpp engine')
      return {
        gpuLayers: 0,
        maxContextLength: 2048,
        noOffloadKVCache: true,
        offloadMmproj: false,
        mode: 'Unsupported',
      }
    } catch (error) {
      console.error(`Error planning model load for path ${modelPath}:`, error)
      return {
        gpuLayers: 0,
        maxContextLength: 2048,
        noOffloadKVCache: true,
        offloadMmproj: false,
        mode: 'Unsupported',
      }
    }
  }
}
