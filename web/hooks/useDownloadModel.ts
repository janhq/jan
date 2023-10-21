import { executeSerial } from '@services/pluginService'
import { DataService, ModelManagementService } from '@janhq/core'
import { ModelVersion } from '@models/ModelVersion'
import { Product } from '@models/Product'
import { AssistantModel } from '@models/AssistantModel'

export default function useDownloadModel() {
  const assistanModel = (
    model: Product,
    modelVersion: ModelVersion
  ): AssistantModel => {
    return {
      _id: modelVersion._id,
      name: modelVersion.name,
      quantMethod: modelVersion.quantMethod,
      bits: modelVersion.bits,
      size: modelVersion.size,
      maxRamRequired: modelVersion.maxRamRequired,
      usecase: modelVersion.usecase,
      downloadLink: modelVersion.downloadLink,
      startDownloadAt: modelVersion.startDownloadAt,
      finishDownloadAt: modelVersion.finishDownloadAt,
      productId: model._id,
      productName: model.name,
      shortDescription: model.shortDescription,
      longDescription: model.longDescription,
      avatarUrl: model.avatarUrl,
      author: model.author,
      version: model.version,
      modelUrl: model.modelUrl,
      nsfw: model.nsfw === true ? false : true,
      greeting: model.greeting,
      type: model.type,
      createdAt: new Date(model.createdAt).getTime(),
      updatedAt: new Date(model.updatedAt ?? '').getTime(),
      status: '',
      releaseDate: -1,
      tags: model.tags,
    }
  }

  const downloadModel = async (model: Product, modelVersion: ModelVersion) => {
    modelVersion.startDownloadAt = Date.now()
    const assistantModel = assistanModel(model, modelVersion)
    await executeSerial(ModelManagementService.StoreModel, assistantModel)
    await executeSerial(ModelManagementService.DownloadModel, {
      downloadUrl: modelVersion.downloadLink,
      fileName: modelVersion._id,
    })
  }

  return {
    downloadModel,
  }
}
