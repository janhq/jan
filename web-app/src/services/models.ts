/* eslint-disable @typescript-eslint/no-explicit-any */
import { sanitizeModelId } from '@/lib/utils'
import {
  AIEngine,
  EngineManager,
  SessionInfo,
  SettingComponentProps,
} from '@janhq/core'
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

// TODO: Replace this with the actual provider later
const defaultProvider = 'llamacpp'

const getEngine = (provider: string = defaultProvider) => {
  return EngineManager.instance().get(provider) as AIEngine | undefined
}
/**
 * Fetches all available models.
 * @returns A promise that resolves to the models.
 */
export const fetchModels = async () => {
  return getEngine()?.list()
}

/**
 * Fetches the model catalog from the GitHub repository.
 * @returns A promise that resolves to the model catalog.
 */
export const fetchModelCatalog = async (): Promise<ModelCatalog> => {
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

/**
 * Fetches HuggingFace repository information.
 * @param repoId The repository ID (e.g., "microsoft/DialoGPT-medium")
 * @returns A promise that resolves to the repository information.
 */
export const fetchHuggingFaceRepo = async (
  repoId: string,
  hfToken?: string
): Promise<HuggingFaceRepo | null> => {
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

    const repoData: HuggingFaceRepo = await response.json()
    return repoData
  } catch (error) {
    console.error('Error fetching HuggingFace repository:', error)
    return null
  }
}

// Convert HuggingFace repository to CatalogModel format
export const convertHfRepoToCatalogModel = (
  repo: HuggingFaceRepo
): CatalogModel => {
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

/**
 * Updates a model.
 * @param model The model to update.
 * @returns A promise that resolves when the model is updated.
 */
export const updateModel = async (
  model: Partial<CoreModel>
  // provider: string,
) => {
  if (model.settings)
    getEngine()?.updateSettings(model.settings as SettingComponentProps[])
}

/**
 * Pull or import a model.
 * @param model The model to pull.
 * @returns A promise that resolves when the model download task is created.
 */
export const pullModel = async (
  id: string,
  modelPath: string,
  modelSha256?: string,
  modelSize?: number,
  mmprojPath?: string,
  mmprojSha256?: string,
  mmprojSize?: number
) => {
  return getEngine()?.import(id, {
    modelPath,
    mmprojPath,
    modelSha256,
    modelSize,
    mmprojSha256,
    mmprojSize,
  })
}

/**
 * Pull a model with real-time metadata fetching from HuggingFace.
 * Extracts hash and size information from the model URL for both main model and mmproj files.
 * @param id The model ID
 * @param modelPath The model file URL (HuggingFace download URL)
 * @param mmprojPath Optional mmproj file URL
 * @param hfToken Optional HuggingFace token for authentication
 * @returns A promise that resolves when the model download task is created.
 */
export const pullModelWithMetadata = async (
  id: string,
  modelPath: string,
  mmprojPath?: string,
  hfToken?: string
) => {
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
      const repoInfo = await fetchHuggingFaceRepo(repoId, hfToken)

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
  return pullModel(
    id,
    modelPath,
    modelSha256,
    modelSize,
    mmprojPath,
    mmprojSha256,
    mmprojSize
  )
}

/**
 * Aborts a model download.
 * @param id
 * @returns
 */
export const abortDownload = async (id: string) => {
  return getEngine()?.abortImport(id)
}

/**
 * Deletes a model.
 * @param id
 * @returns
 */
export const deleteModel = async (id: string) => {
  return getEngine()?.delete(id)
}

/**
 * Gets the active models for a given provider.
 * @param provider
 * @returns
 */
export const getActiveModels = async (provider?: string) => {
  // getEngine(provider)
  return getEngine(provider)?.getLoadedModels()
}

/**
 * Stops a model for a given provider.
 * @param model
 * @param provider
 * @returns
 */
export const stopModel = async (model: string, provider?: string) => {
  getEngine(provider)?.unload(model)
}

/**
 * Stops all active models.
 * @returns
 */
export const stopAllModels = async () => {
  const models = await getActiveModels()
  if (models) await Promise.all(models.map((model) => stopModel(model)))
}

/**
 * @fileoverview Helper function to start a model.
 * This function loads the model from the provider.
 * Provider's chat function will handle loading the model.
 * @param provider
 * @param model
 * @returns
 */
export const startModel = async (
  provider: ProviderObject,
  model: string
): Promise<SessionInfo | undefined> => {
  const engine = getEngine(provider.provider)
  if (!engine) return undefined

  if ((await engine.getLoadedModels()).includes(model)) return undefined

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

/**
 * Check if model support tool use capability
 * Returned by backend engine
 * @param modelId
 * @returns
 */
export const isToolSupported = async (modelId: string): Promise<boolean> => {
  const engine = getEngine()
  if (!engine) return false

  return engine.isToolSupported(modelId)
}

/**
 * Checks if mmproj.gguf file exists for a given model ID in the llamacpp provider.
 * Also checks if the model has offload_mmproj setting.
 * If mmproj.gguf exists, adds offload_mmproj setting with value true.
 * @param modelId - The model ID to check for mmproj.gguf
 * @param updateProvider - Function to update the provider state
 * @param getProviderByName - Function to get provider by name
 * @returns Promise<{exists: boolean, settingsUpdated: boolean}> - exists: true if mmproj.gguf exists, settingsUpdated: true if settings were modified
 */
export const checkMmprojExistsAndUpdateOffloadMMprojSetting = async (
  modelId: string,
  updateProvider?: (providerName: string, data: Partial<ModelProvider>) => void,
  getProviderByName?: (providerName: string) => ModelProvider | undefined
): Promise<{ exists: boolean; settingsUpdated: boolean }> => {
  let settingsUpdated = false

  try {
    const engine = getEngine('llamacpp') as AIEngine & {
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
            (p: any) => p.provider === 'llamacpp'
          )
          const model = llamacppProvider?.models?.find(
            (m: any) => m.id === modelId
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

/**
 * Checks if mmproj.gguf file exists for a given model ID in the llamacpp provider.
 * If mmproj.gguf exists, adds offload_mmproj setting with value true.
 * @param modelId - The model ID to check for mmproj.gguf
 * @returns Promise<{exists: boolean, settingsUpdated: boolean}> - exists: true if mmproj.gguf exists, settingsUpdated: true if settings were modified
 */
export const checkMmprojExists = async (modelId: string): Promise<boolean> => {
  try {
    const engine = getEngine('llamacpp') as AIEngine & {
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

/**
 * Checks if a model is supported by analyzing memory requirements and system resources.
 * @param modelPath - The path to the model file (local path or URL)
 * @param ctxSize - The context size for the model (default: 4096)
 * @returns Promise<'RED' | 'YELLOW' | 'GREEN'> - Support status:
 *   - 'RED': Model weights don't fit in available memory
 *   - 'YELLOW': Model weights fit, but KV cache doesn't
 *   - 'GREEN': Both model weights and KV cache fit in available memory
 */
export const isModelSupported = async (
  modelPath: string,
  ctxSize?: number
): Promise<'RED' | 'YELLOW' | 'GREEN' | 'GREY'> => {
  try {
    const engine = getEngine('llamacpp') as AIEngine & {
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
