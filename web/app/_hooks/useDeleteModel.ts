import { execute, executeSerial } from "@/_services/pluginService";
import { DataService, ModelManagementService } from "../../shared/coreService";
import { Product } from "@/_models/Product";

export default function useDeleteModel() {
  const deleteModel = async (model: Product) => {
    execute(DataService.DELETE_DOWNLOAD_MODEL, model.id);
    await executeSerial(ModelManagementService.DELETE_MODEL, model.fileName);
  };

  return { deleteModel };
}
