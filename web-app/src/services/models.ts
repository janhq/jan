/* eslint-disable @typescript-eslint/no-explicit-any */
import { ExtensionManager } from '@/lib/extension'
import { normalizeProvider } from '@/lib/models'
import { EngineManager, ExtensionTypeEnum, ModelExtension } from '@janhq/core'
import { Model as CoreModel } from '@janhq/core'

/**
 * Fetches all available models.
 * @returns A promise that resolves to the models.
 */
export const fetchModels = async () => {
  return ExtensionManager.getInstance()
    .get<ModelExtension>(ExtensionTypeEnum.Model)
    ?.getModels()
}

/**
 * Fetches the sources of the models.
 * @returns A promise that resolves to the model sources.
 */
export const fetchModelSources = async (): Promise<any[]> => {
  const extension = ExtensionManager.getInstance().get<ModelExtension>(
    ExtensionTypeEnum.Model
  )

  if (!extension) return []

  try {
    const sources = await extension.getSources()
    const mappedSources = sources.map((m) => ({
      ...m,
      models: m.models.sort((a, b) => a.size - b.size),
    }))

    // Prepend the hardcoded model to the sources
    return [...mappedSources]
  } catch (error) {
    console.error('Failed to fetch model sources:', error)
    return []
  }
}

/**
 * Fetches the model hub.
 * @returns A promise that resolves to the model hub.
 */
export const fetchModelHub = async (): Promise<any[]> => {
  const hubData = await ExtensionManager.getInstance()
    .get<ModelExtension>(ExtensionTypeEnum.Model)
    ?.fetchModelsHub()

  // Prepend the hardcoded model to the hub data
  return hubData ? [...hubData] : []
}

/**
 * Adds a new model source.
 * @param source The source to add.
 * @returns A promise that resolves when the source is added.
 */
export const addModelSource = async (source: string) => {
  const extension = ExtensionManager.getInstance().get<ModelExtension>(
    ExtensionTypeEnum.Model
  )

  if (!extension) throw new Error('Model extension not found')

  try {
    return await extension.addSource(source)
  } catch (error) {
    console.error('Failed to add model source:', error)
    throw error
  }
}

/**
 * Deletes a model source.
 * @param source The source to delete.
 * @returns A promise that resolves when the source is deleted.
 */
export const deleteModelSource = async (source: string) => {
  const extension = ExtensionManager.getInstance().get<ModelExtension>(
    ExtensionTypeEnum.Model
  )

  if (!extension) throw new Error('Model extension not found')

  try {
    return await extension.deleteSource(source)
  } catch (error) {
    console.error('Failed to delete model source:', error)
    throw error
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
  const extension = ExtensionManager.getInstance().get<ModelExtension>(
    ExtensionTypeEnum.Model
  )

  if (!extension) throw new Error('Model extension not found')

  try {
    return await extension.updateModel(model)
  } catch (error) {
    console.error('Failed to update model:', error)
    throw error
  }
}

/**
 * Downloads a model.
 * @param model The model to download.
 * @returns A promise that resolves when the model download task is created.
 */
export const downloadModel = async (id: string) => {
  const extension = ExtensionManager.getInstance().get<ModelExtension>(
    ExtensionTypeEnum.Model
  )

  if (!extension) throw new Error('Model extension not found')

  try {
    return await extension.pullModel(id)
  } catch (error) {
    console.error('Failed to download model:', error)
    throw error
  }
}

/**
 * Aborts a model download.
 * @param id
 * @returns
 */
export const abortDownload = async (id: string) => {
  const extension = ExtensionManager.getInstance().get<ModelExtension>(
    ExtensionTypeEnum.Model
  )

  if (!extension) throw new Error('Model extension not found')

  try {
    return await extension.cancelModelPull(id)
  } catch (error) {
    console.error('Failed to abort model download:', error)
    throw error
  }
}

/**
 * Deletes a model.
 * @param id
 * @returns
 */
export const deleteModel = async (id: string) => {
  const extension = ExtensionManager.getInstance().get<ModelExtension>(
    ExtensionTypeEnum.Model
  )

  if (!extension) throw new Error('Model extension not found')

  try {
    return await extension.deleteModel(id).then(() => {
      // TODO: This should be removed when we integrate new llama.cpp extension
      if (id.includes(':')) {
        extension.addSource(`cortexso/${id.split(':')[0]}`)
      }
    })
  } catch (error) {
    console.error('Failed to delete model:', error)
    throw error
  }
}

/**
 * Imports a model from a file path.
 * @param filePath The path to the model file or an array of file paths.
 * @param modelId Optional model ID. If not provided, it will be derived from the file name.
 * @param provider The provider for the model (default: 'llama.cpp').
 * @returns A promise that resolves when the model is imported.
 */
export const importModel = async (
  filePath: string | string[],
  modelId?: string,
  provider: string = 'llama.cpp'
) => {
  const extension = ExtensionManager.getInstance().get<ModelExtension>(
    ExtensionTypeEnum.Model
  )

  if (!extension) throw new Error('Model extension not found')

  try {
    // If filePath is an array, use the first element
    const path = Array.isArray(filePath) ? filePath[0] : filePath

    // If no path was selected, throw an error
    if (!path) throw new Error('No file selected')

    // Extract filename from path to use as model ID if not provided
    const defaultModelId =
      path
        .split(/[/\\]/)
        .pop()
        ?.replace(/ /g, '-')
        .replace(/\.gguf$/i, '') || path
    const modelIdToUse = modelId || defaultModelId

    return await extension.importModel(modelIdToUse, path, provider)
  } catch (error) {
    console.error('Failed to import model:', error)
    throw error
  }
}

/**
 * Gets the active models for a given provider.
 * @param provider
 * @returns
 */
export const getActiveModels = async (provider?: string) => {
  const providerName = provider || 'cortex' // we will go down to llama.cpp extension later on
  const extension = EngineManager.instance().get(providerName)

  if (!extension) throw new Error('Model extension not found')

  try {
    return 'activeModels' in extension &&
      typeof extension.activeModels === 'function'
      ? ((await extension.activeModels()) ?? [])
      : []
  } catch (error) {
    console.error('Failed to get active models:', error)
    return []
  }
}

/**
 * Stops a model for a given provider.
 * @param model
 * @param provider
 * @returns
 */
export const stopModel = async (model: string, provider?: string) => {
  const providerName = provider || 'cortex' // we will go down to llama.cpp extension later on
  const extension = EngineManager.instance().get(providerName)

  if (!extension) throw new Error('Model extension not found')

  try {
    return await extension.unloadModel({
      model,
      id: model,
    })
  } catch (error) {
    console.error('Failed to stop model:', error)
    return []
  }
}

/**
 * Stops all active models.
 * @returns
 */
export const stopAllModels = async () => {
  const models = await getActiveModels()
  if (models)
    await Promise.all(
      models.map((model: { id: string }) => stopModel(model.id))
    )
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
  model: string,
  abortController?: AbortController
): Promise<void> => {
  const providerObj = EngineManager.instance().get(
    normalizeProvider(provider.provider)
  )
  const modelObj = provider.models.find((m) => m.id === model)

  if (providerObj && modelObj) {
    return providerObj?.loadModel(
      {
        id: modelObj.id,
        settings: Object.fromEntries(
          Object.entries(modelObj.settings ?? {}).map(([key, value]) => [
            key,
            value.controller_props?.value, // assuming each setting is { value: ... }
          ])
        ),
      },
      abortController
    )
  }
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
  const extension = ExtensionManager.getInstance().get<ModelExtension>(
    ExtensionTypeEnum.Model
  )

  if (!extension) throw new Error('Model extension not found')
  try {
    await extension.configurePullOptions(
      proxyEnabled
        ? {
            proxy_username: proxyUsername,
            proxy_password: proxyPassword,
            proxy_url: proxyUrl,
            verify_proxy_ssl: proxyIgnoreSSL ? false : verifyProxySSL,
            verify_proxy_host_ssl: proxyIgnoreSSL ? false : verifyProxyHostSSL,
            verify_peer_ssl: proxyIgnoreSSL ? false : verifyPeerSSL,
            verify_host_ssl: proxyIgnoreSSL ? false : verifyHostSSL,
            no_proxy: noProxy,
          }
        : {
            proxy_username: '',
            proxy_password: '',
            proxy_url: '',
            verify_proxy_ssl: false,
            verify_proxy_host_ssl: false,
            verify_peer_ssl: false,
            verify_host_ssl: false,
            no_proxy: '',
          }
    )
  } catch (error) {
    console.error('Failed to configure pull options:', error)
    throw error
  }
}
