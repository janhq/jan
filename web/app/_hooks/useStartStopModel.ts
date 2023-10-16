import { executeSerial } from "@/_services/pluginService";
import { ModelManagementService, InferenceService } from "@janhq/plugin-core";
import useInitModel from "./useInitModel";
import { useSetAtom } from "jotai";
import { activeAssistantModelAtom } from "@/_helpers/atoms/Model.atom";

export default function useStartStopModel() {
  const { initModel } = useInitModel();
  const setActiveModel = useSetAtom(activeAssistantModelAtom);

  const startModel = async (modelId: string) => {
    const model = await executeSerial(ModelManagementService.GetModelById, modelId);
    if (!model) {
      alert(`Model ${modelId} not found! Please re-download the model first.`);
    } else {
      await initModel(model);
    }
  };

  const stopModel = async (modelId: string) => {
    await executeSerial(InferenceService.StopModel, modelId);
    setActiveModel(undefined);
  };

  return { startModel, stopModel };
}
