// import useGetCurrentUser from "./useGetCurrentUser";
import { useAtom, useSetAtom } from "jotai";
import {
  addNewConversationStateAtom,
  setActiveConvoIdAtom,
  userConversationsAtom,
} from "@/_helpers/JotaiWrapper";
import { Conversation } from "@/_models/Conversation";
import { executeSerial } from "@/_services/pluginService";
import { DataService } from "../../shared/coreService";

const useCreateConversation = () => {
  const [userConversations, setUserConversations] = useAtom(
    userConversationsAtom
  );
  const setActiveConvoId = useSetAtom(setActiveConvoIdAtom);
  const addNewConvoState = useSetAtom(addNewConversationStateAtom);

  const requestCreateConvo = async (model_id: number = 0) => {
    const conv: Conversation = {
      image: undefined,
      model_id,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      name: "Conversation",
    };
    const id = await executeSerial(DataService.CREATE_CONVERSATION, conv);

    const mappedConvo: Conversation = {
      id,
      model_id,
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
