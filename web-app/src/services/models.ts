/* eslint-disable @typescript-eslint/no-explicit-any */
import { AIEngine, EngineManager, SettingComponentProps } from '@janhq/core'
import { Model as CoreModel } from '@janhq/core'

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
 * Fetches the sources of the models.
 * @returns A promise that resolves to the model sources.
 */
export const fetchModelSources = async () => {
  // TODO: New Hub
  return []
}

/**
 * Fetches the model hub.
 * @returns A promise that resolves to the model hub.
 */
export const fetchModelHub = async () => {
  // TODO: New Hub
  return
}

/**
 * Adds a new model source.
 * @param source The source to add.
 * @returns A promise that resolves when the source is added.
 */
export const addModelSource = async (source: string) => {
  // TODO: New Hub
  console.log(source)
  return
}

/**
 * Deletes a model source.
 * @param source The source to delete.
 * @returns A promise that resolves when the source is deleted.
 */
export const deleteModelSource = async (source: string) => {
  // TODO: New Hub
  console.log(source)
  return
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
): Promise<void> => {
  getEngine(provider.provider)
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
