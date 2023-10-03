import { executeSerial } from "@/_services/pluginService";
import { DataService, ModelManagementService } from "../../shared/coreService";
import { Product } from "@/_models/Product";

export default function useDownloadModel() {
  const downloadModel = async (model: Product) => {
    await executeSerial(DataService.STORE_MODEL, model);
    await executeSerial(ModelManagementService.DOWNLOAD_MODEL, {
      downloadUrl: model.downloadUrl,
      fileName: model.fileName,
    });
  };

  return {
    downloadModel,
  };
}
