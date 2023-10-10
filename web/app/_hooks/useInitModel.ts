import { Product } from "@/_models/Product";
import { executeSerial } from "@/_services/pluginService";
import { InferenceService } from "../../shared/coreService";
import { useAtom } from "jotai";
import { currentProductAtom } from "@/_helpers/atoms/Model.atom";

export default function useInitModel() {
  const [activeModel, setActiveModel] = useAtom(currentProductAtom);

  const initModel = async (model: Product) => {
    if (activeModel && activeModel.id === model.id) {
      console.debug(`Model ${model.id} is already init. Ignore..`);
      return;
    }
    const res = await executeSerial(InferenceService.INIT_MODEL, model);
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
