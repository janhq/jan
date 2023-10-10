import { execute, executeSerial } from "@/_services/pluginService";
import { DataService, ModelManagementService } from "../../shared/coreService";
import { useSetAtom } from "jotai";
import { downloadedModelAtom } from "@/_helpers/atoms/DownloadedModel.atom";
import { getDownloadedModels } from "./useGetDownloadedModels";
import { AssistantModel } from "@/_models/AssistantModel";

export default function useDeleteModel() {
  const setDownloadedModels = useSetAtom(downloadedModelAtom);

  const deleteModel = async (model: AssistantModel) => {
    execute(DataService.DELETE_DOWNLOAD_MODEL, model.id);
    await executeSerial(ModelManagementService.DELETE_MODEL, model.id);

    // reload models
    const downloadedModels = await getDownloadedModels();
    setDownloadedModels(downloadedModels);
  };

  return { deleteModel };
}
