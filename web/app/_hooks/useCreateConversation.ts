import { useAtom, useSetAtom } from "jotai";
import { Conversation } from "@/_models/Conversation";
import { executeSerial } from "@/_services/pluginService";
import { DataService } from "../../shared/coreService";
import { Product } from "@/_models/Product";
import {
  userConversationsAtom,
  setActiveConvoIdAtom,
  addNewConversationStateAtom,
} from "@/_helpers/atoms/Conversation.atom";
import useInitModel from "./useInitModel";

const useCreateConversation = () => {
  const { initModel } = useInitModel();
  const [userConversations, setUserConversations] = useAtom(
    userConversationsAtom
  );
  const setActiveConvoId = useSetAtom(setActiveConvoIdAtom);
  const addNewConvoState = useSetAtom(addNewConversationStateAtom);

  const requestCreateConvo = async (model: Product) => {
    const conversationName = model.name;
    const conv: Conversation = {
      model_id: model.id,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      name: conversationName,
    };
    const id = await executeSerial(DataService.CREATE_CONVERSATION, conv);
    await initModel(model);

    const mappedConvo: Conversation = {
      id,
      model_id: model.id,
      name: conversationName,
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
