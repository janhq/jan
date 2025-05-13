import { ExtensionManager } from '@/lib/extension'
import { ExtensionTypeEnum, ModelExtension } from '@janhq/core'

export const fetchModels = async () => {
  return ExtensionManager.getInstance()
    .get<ModelExtension>(ExtensionTypeEnum.Model)
    ?.getModels()
}

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
