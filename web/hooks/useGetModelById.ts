import { ModelManagementService } from '@janhq/core'
import { executeSerial } from '../../electron/core/plugin-manager/execution/extension-manager'

export default function useGetModelById() {
  const getModelById = async (
    modelId: string
  ): Promise<AssistantModel | undefined> => {
    return queryModelById(modelId)
  }

  return { getModelById }
}

const queryModelById = async (
  modelId: string
): Promise<AssistantModel | undefined> => {
  const model = await executeSerial(
    ModelManagementService.GetModelById,
    modelId
  )

  return model
}
