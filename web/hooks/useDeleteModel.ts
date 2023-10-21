import { execute, executeSerial } from '@services/pluginService'
import { ModelManagementService } from '@janhq/core'
import { useSetAtom } from 'jotai'
import { downloadedModelAtom } from '@helpers/atoms/DownloadedModel.atom'
import { getDownloadedModels } from './useGetDownloadedModels'
import { AssistantModel } from '@models/AssistantModel'

export default function useDeleteModel() {
  const setDownloadedModels = useSetAtom(downloadedModelAtom)

  const deleteModel = async (model: AssistantModel) => {
    execute(ModelManagementService.DeleteDownloadModel, model._id)
    await executeSerial(ModelManagementService.DeleteModel, model._id)

    // reload models
    const downloadedModels = await getDownloadedModels()
    setDownloadedModels(downloadedModels)
  }

  return { deleteModel }
}
