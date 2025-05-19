import { ExtensionManager } from '@/lib/extension'
import { ExtensionTypeEnum, ModelExtension } from '@janhq/core'
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
export const fetchModelSources = async () => {
  const extension = ExtensionManager.getInstance().get<ModelExtension>(
    ExtensionTypeEnum.Model
  )

  if (!extension) return []

  try {
    const sources = await extension.getSources()
    return sources.map((m) => ({
      ...m,
      models: m.models.sort((a, b) => a.size - b.size),
    }))
  } catch (error) {
    console.error('Failed to fetch model sources:', error)
    return []
  }
}

/**
 * Fetches the model hub.
 * @returns A promise that resolves to the model hub.
 */
export const fetchModelHub = async () => {
  return ExtensionManager.getInstance()
    .get<ModelExtension>(ExtensionTypeEnum.Model)
    ?.fetchModelsHub()
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
    return await extension.deleteModel(id)
  } catch (error) {
    console.error('Failed to delete model:', error)
    throw error
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
