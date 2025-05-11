import { ExtensionManager } from '@/lib/extension'
import { ExtensionTypeEnum, ModelExtension } from '@janhq/core'

export const fetchModels = async () => {
  return ExtensionManager.getInstance()
    .get<ModelExtension>(ExtensionTypeEnum.Model)
    ?.getModels()
}
