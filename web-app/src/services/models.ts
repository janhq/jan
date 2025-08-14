import {
  AIEngine,
  EngineManager,
  SessionInfo,
  SettingComponentProps,
} from '@janhq/core'
import { Model as CoreModel } from '@janhq/core'
import { sanitizeModelId } from '@/lib/utils'
// Types for model catalog
export interface ModelQuant {
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
  created_at?: string
  readme?: string
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
  created_at: string
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
      `https://huggingface.co/api/models/${cleanRepoId}?blobs=true`,
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
  // Extract GGUF files from the repository siblings
  const ggufFiles =
    repo.siblings?.filter((file) =>
      file.rfilename.toLowerCase().endsWith('.gguf')
    ) || []

  // Convert GGUF files to quants format
  const quants = ggufFiles.map((file) => {
    // Format file size
    const formatFileSize = (size?: number) => {
      if (!size) return 'Unknown size'
      if (size < 1024 ** 3) return `${(size / 1024 ** 2).toFixed(1)} MB`
      return `${(size / 1024 ** 3).toFixed(1)} GB`
    }

    // Generate model_id from filename (remove .gguf extension, case-insensitive)
    const modelId = sanitizeModelId(file.rfilename.replace(/\.gguf$/i, ''))

    return {
      model_id: modelId,
      path: `https://huggingface.co/${repo.modelId}/resolve/main/${file.rfilename}`,
      file_size: formatFileSize(file.size),
    }
  })

  return {
    model_name: repo.modelId,
    description: `**Tags**: ${repo.tags?.join(', ')}`,
    developer: repo.author,
    downloads: repo.downloads || 0,
    num_quants: quants.length,
    quants: quants,
    created_at: repo.created_at,
    readme: `https://huggingface.co/${repo.modelId}/resolve/main/README.md`,
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
export const pullModel = async (id: string, modelPath: string) => {
  return getEngine()?.import(id, {
    modelPath,
  })
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
