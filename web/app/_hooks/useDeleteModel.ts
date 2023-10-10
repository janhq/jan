import { execute, executeSerial } from "@/_services/pluginService";
import { DataService, ModelManagementService } from "../../shared/coreService";
import { Product } from "@/_models/Product";
import { useSetAtom } from "jotai";
import { downloadedModelAtom } from "@/_helpers/atoms/DownloadedModel.atom";
import { getDownloadedModels } from "./useGetDownloadedModels";

export default function useDeleteModel() {
  const setDownloadedModels = useSetAtom(downloadedModelAtom);

  const deleteModel = async (model: Product) => {
    execute(DataService.DELETE_DOWNLOAD_MODEL, model.id);
    await executeSerial(ModelManagementService.DELETE_MODEL, model.fileName);

    // reload models
    const downloadedModels = await getDownloadedModels();
    setDownloadedModels(downloadedModels);
  };

  return { deleteModel };
}
