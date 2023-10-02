import { useAtom, useSetAtom } from "jotai";
import { Conversation } from "@/_models/Conversation";
import { executeSerial } from "@/_services/pluginService";
import { DataService, InfereceService } from "../../shared/coreService";
import { Product } from "@/_models/Product";
import {
  userConversationsAtom,
  setActiveConvoIdAtom,
  addNewConversationStateAtom,
} from "@/_helpers/atoms/Conversation.atom";
import { currentProductAtom } from "@/_helpers/atoms/Model.atom";

const useCreateConversation = () => {
  const [userConversations, setUserConversations] = useAtom(
    userConversationsAtom
  );
  const setActiveConvoId = useSetAtom(setActiveConvoIdAtom);
  const addNewConvoState = useSetAtom(addNewConversationStateAtom);
  const setActiveProduct = useSetAtom(currentProductAtom);

  const requestCreateConvo = async (model: Product) => {
    const conv: Conversation = {
      image: undefined,
      model_id: model.id,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      name: "Conversation",
    };
    const id = await executeSerial(DataService.CREATE_CONVERSATION, conv);
    await executeSerial(InfereceService.INIT_MODEL, model);
    setActiveProduct(model);

    const mappedConvo: Conversation = {
      id,
      model_id: model.id,
      name: "Conversation",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    addNewConvoState(id ?? "", {
      hasMore: true,
      waitingForResponse: false,
    });
    setUserConversations([mappedConvo, ...userConversations]);
    setActiveConvoId(id);
  };

  return {
    requestCreateConvo,
  };
};

export default useCreateConversation;
