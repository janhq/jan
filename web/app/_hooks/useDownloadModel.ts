import { executeSerial } from "@/_services/pluginService";
import { DataService, ModelManagementService } from "../../shared/coreService";
import { ModelVersion, Product } from "@/_models/Product";

export default function useDownloadModel() {
  const downloadModel = async (model: Product) => {
    await executeSerial(DataService.STORE_MODEL, model);
    await executeSerial(ModelManagementService.DOWNLOAD_MODEL, {
      downloadUrl: model.downloadUrl,
      fileName: model.fileName,
    });
  };

  const downloadHfModel = async (
    model: Product,
    modelVersion: ModelVersion
  ) => {
    const hfModel: Product = {
      ...model,
      id: `${model.author}.${modelVersion.path}`,
      slug: `${model.author}.${modelVersion.path}`,
      name: `${model.name} - ${modelVersion.path}`,
      fileName: modelVersion.path,
      totalSize: modelVersion.size,
      downloadUrl: modelVersion.downloadUrl,
    };
    await executeSerial(DataService.STORE_MODEL, hfModel);
    await executeSerial(ModelManagementService.DOWNLOAD_MODEL, {
      downloadUrl: hfModel.downloadUrl,
      fileName: hfModel.fileName,
    });
  };

  return {
    downloadModel,
    downloadHfModel,
  };
}
