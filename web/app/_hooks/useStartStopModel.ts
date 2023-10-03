import { executeSerial } from "@/_services/pluginService";
import { DataService } from "../../shared/coreService";
import useInitModel from "./useInitModel";

export default function useStartStopModel() {
  const { initModel } = useInitModel();

  const startModel = async (modelId: string) => {
    const model = await executeSerial(DataService.GET_MODEL_BY_ID, modelId);
    if (!model) {
      alert(`Model ${modelId} not found! Please re-download the model first.`);
    } else {
      await initModel(model);
    }
  };

  const stopModel = async (modelId: string) => {};

  return { startModel, stopModel };
}
