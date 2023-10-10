import { Product } from "@/_models/Product";
import { executeSerial } from "@/_services/pluginService";
import { InfereceService } from "../../shared/coreService";
import { useAtom, useSetAtom } from "jotai";
import { currentProductAtom } from "@/_helpers/atoms/Model.atom";
import { updateConversationWaitingForResponseAtom } from "@/_helpers/atoms/Conversation.atom";

export default function useInitModel() {
  const [activeModel, setActiveModel] = useAtom(currentProductAtom);
  const updateConvWaiting = useSetAtom(
    updateConversationWaitingForResponseAtom
  );

  const initModel = async (model: Product) => {
    if (activeModel && activeModel.id === model.id) {
      console.debug(`Model ${model.id} is already init. Ignore..`);
      return;
    }
    const res = await executeSerial(InfereceService.INIT_MODEL, model);
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
