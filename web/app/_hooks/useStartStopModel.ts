import { currentProductAtom } from "@/_helpers/JotaiWrapper";
import { executeSerial } from "@/_services/pluginService";
import { DataService, InfereceService } from "../../shared/coreService";
import { useSetAtom } from "jotai";

export default function useStartStopModel() {
  const setActiveModel = useSetAtom(currentProductAtom);

  const startModel = async (modelId: string) => {
    const model = await executeSerial(DataService.GET_MODEL_BY_ID, modelId);
    if (!model) {
      alert(`Model ${modelId} not found! Please re-download the model first.`);
    } else {
      setActiveModel(model);
      executeSerial(InfereceService.INIT_MODEL, model)
        .then(() => console.info(`Init model success`))
        .catch((err) => console.log(`Init model error ${err}`));
    }
  };

  const stopModel = async (modelId: string) => {};

  return { startModel, stopModel };
}
