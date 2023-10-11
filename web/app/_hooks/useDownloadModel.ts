import { executeSerial } from "@/_services/pluginService";
import { DataService, ModelManagementService } from "@janhq/plugin-core";
import { ModelVersion } from "@/_models/ModelVersion";
import { Product } from "@/_models/Product";

export default function useDownloadModel() {
  const downloadModel = async (model: Product, modelVersion: ModelVersion) => {
    modelVersion.startDownloadAt = Date.now();

    await executeSerial(DataService.STORE_MODEL, { model, modelVersion });
    await executeSerial(ModelManagementService.DOWNLOAD_MODEL, {
      downloadUrl: modelVersion.downloadLink,
      fileName: modelVersion.id,
    });
  };

  return {
    downloadModel,
  };
}
