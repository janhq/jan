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

// TODO: Replace this with the actual provider later
const defaultProvider = 'llamacpp'

const getEngine = (provider: string = defaultProvider) => {
  return EngineManager.instance().get(provider) as AIEngine
}
/**
 * Fetches all available models.
 * @returns A promise that resolves to the models.
 */
export const fetchModels = async () => {
  return getEngine().list()
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
 * Updates a model.
 * @param model The model to update.
 * @returns A promise that resolves when the model is updated.
 */
export const updateModel = async (
  model: Partial<CoreModel>
  // provider: string,
) => {
  if (model.settings)
    getEngine().updateSettings(model.settings as SettingComponentProps[])
}

/**
 * Pull or import a model.
 * @param model The model to pull.
 * @returns A promise that resolves when the model download task is created.
 */
export const pullModel = async (id: string, modelPath: string) => {
  return getEngine().import(id, {
    modelPath,
  })
}

/**
 * Aborts a model download.
 * @param id
 * @returns
 */
export const abortDownload = async (id: string) => {
  return getEngine().abortImport(id)
}

/**
 * Deletes a model.
 * @param id
 * @returns
 */
export const deleteModel = async (id: string) => {
  return getEngine().delete(id)
}

/**
 * Gets the active models for a given provider.
 * @param provider
 * @returns
 */
export const getActiveModels = async (provider?: string) => {
  // getEngine(provider)
  return getEngine(provider).getLoadedModels()
}

/**
 * Stops a model for a given provider.
 * @param model
 * @param provider
 * @returns
 */
export const stopModel = async (model: string, provider?: string) => {
  getEngine(provider).unload(model)
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
): Promise<SessionInfo> => {
  return getEngine(provider.provider)
    .load(model)
    .catch((error) => {
      console.error(
        `Failed to start model ${model} for provider ${provider.provider}:`,
        error
      )
      throw error
    })
}

/**
 * Configures the proxy options for model downloads.
 * @param param0
 */
export const configurePullOptions = async ({
  proxyEnabled,
  proxyUrl,
  proxyUsername,
  proxyPassword,
  proxyIgnoreSSL,
  verifyProxySSL,
  verifyProxyHostSSL,
  verifyPeerSSL,
  verifyHostSSL,
  noProxy,
}: ProxyOptions) => {
  console.log('Configuring proxy options:', {
    proxyEnabled,
    proxyUrl,
    proxyUsername,
    proxyPassword,
    proxyIgnoreSSL,
    verifyProxySSL,
    verifyProxyHostSSL,
    verifyPeerSSL,
    verifyHostSSL,
    noProxy,
  })
}
