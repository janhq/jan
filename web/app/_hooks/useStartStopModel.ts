import { executeSerial } from "@/_services/pluginService";
import { DataService, InfereceService } from "../../shared/coreService";
import useInitModel from "./useInitModel";
import { useSetAtom } from "jotai";
import { currentProductAtom } from "@/_helpers/atoms/Model.atom";

export default function useStartStopModel() {
  const { initModel } = useInitModel();
  const setActiveModel = useSetAtom(currentProductAtom);

  const startModel = async (modelId: string) => {
    const model = await executeSerial(DataService.GET_MODEL_BY_ID, modelId);
    if (!model) {
      alert(`Model ${modelId} not found! Please re-download the model first.`);
    } else {
      await initModel(model);
    }
  };

  const stopModel = async (modelId: string) => {
    await executeSerial(InfereceService.STOP_MODEL, modelId);
    setActiveModel(undefined);
  };

  return { startModel, stopModel };
}
