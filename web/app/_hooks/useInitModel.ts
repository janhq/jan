import { Product } from "@/_models/Product";
import { executeSerial } from "@/_services/pluginService";
import { InfereceService } from "../../shared/coreService";
import { useAtom } from "jotai";
import { currentProductAtom } from "@/_helpers/atoms/Model.atom";

export default function useInitModel() {
  const [activeModel, setActiveModel] = useAtom(currentProductAtom);

  const initModel = async (model: Product) => {
    if (activeModel && activeModel.id === model.id) {
      console.debug(`Model ${model.id} is already init. Ignore..`);
      return;
    }
    try {
      await executeSerial(InfereceService.INIT_MODEL, model);
      console.debug(`Init model ${model.name} successfully!`);
      setActiveModel(model);
    } catch (err) {
      console.error(`Init model ${model.name} failed: ${err}`);
    }
  };

  return { initModel };
}
