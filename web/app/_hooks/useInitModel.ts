import { executeSerial } from "@/_services/pluginService";
import { InferenceService } from "../../shared/coreService";
import { useAtom } from "jotai";
import { activeAssistantModelAtom } from "@/_helpers/atoms/Model.atom";
import { AssistantModel } from "@/_models/AssistantModel";

export default function useInitModel() {
  const [activeModel, setActiveModel] = useAtom(activeAssistantModelAtom);

  const initModel = async (model: AssistantModel) => {
    if (activeModel && activeModel.id === model.id) {
      console.debug(`Model ${model.id} is already init. Ignore..`);
      return;
    }

    const res = await executeSerial(InferenceService.INIT_MODEL, model.id);
    if (res?.error) {
      console.log("error occured: ", res);
      return res;
    } else {
      console.log(`Init model successfully!`);
      setActiveModel(model);
      return {};
    }
  };

  return { initModel };
}
