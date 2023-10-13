import { execute, executeSerial } from "@/_services/pluginService";
import { DataService, ModelManagementService } from "@janhq/plugin-core";
import { useSetAtom } from "jotai";
import { downloadedModelAtom } from "@/_helpers/atoms/DownloadedModel.atom";
import { getDownloadedModels } from "./useGetDownloadedModels";
import { AssistantModel } from "@/_models/AssistantModel";

export default function useDeleteModel() {
  const setDownloadedModels = useSetAtom(downloadedModelAtom);

  const deleteModel = async (model: AssistantModel) => {
    execute(DataService.DeleteDownloadModel, model._id);
    await executeSerial(ModelManagementService.DeleteModel, model._id);

    // reload models
    const downloadedModels = await getDownloadedModels();
    setDownloadedModels(downloadedModels);
  };

  return { deleteModel };
}
