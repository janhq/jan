import { useAtom, useSetAtom } from "jotai";
import { Conversation } from "@/_models/Conversation";
import { executeSerial } from "@/_services/pluginService";
import { DataService } from "@janhq/plugin-core";
import {
  userConversationsAtom,
  setActiveConvoIdAtom,
  addNewConversationStateAtom,
  updateConversationWaitingForResponseAtom,
  updateConversationErrorAtom,
} from "@/_helpers/atoms/Conversation.atom";
import useInitModel from "./useInitModel";
import { AssistantModel } from "@/_models/AssistantModel";

const useCreateConversation = () => {
  const { initModel } = useInitModel();
  const [userConversations, setUserConversations] = useAtom(
    userConversationsAtom
  );
  const setActiveConvoId = useSetAtom(setActiveConvoIdAtom);
  const addNewConvoState = useSetAtom(addNewConversationStateAtom);
  const updateConvWaiting = useSetAtom(
    updateConversationWaitingForResponseAtom
  );
  const updateConvError = useSetAtom(updateConversationErrorAtom);

  const requestCreateConvo = async (model: AssistantModel) => {
    const conversationName = model.name;
    const conv: Conversation = {
      model_id: model._id,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      name: conversationName,
    };
    const id = await executeSerial(DataService.CreateConversation, conv);

    if (id) updateConvWaiting(id, true);
    initModel(model).then((res: any) => {
      if (id) updateConvWaiting(id, false);
      if (res?.error) {
        updateConvError(id, res.error);
      }
    });

    const mappedConvo: Conversation = {
      _id: id,
      model_id: model._id,
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
