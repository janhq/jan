import { Conversation, ConversationState } from "@/_models/Conversation";
import { useSetAtom } from "jotai";
import {
  conversationStatesAtom,
  userConversationsAtom,
} from "@/_helpers/JotaiWrapper";
import { executeSerial } from "@/_services/pluginService";
import { DataService } from "../../shared/coreService";

const useGetUserConversations = () => {
  const setConversationStates = useSetAtom(conversationStatesAtom);
  const setConversations = useSetAtom(userConversationsAtom);

  const getUserConversations = async () => {
    try {
      const convos: Conversation[] = await executeSerial(DataService.GET_CONVERSATIONS);
      const convoStates: Record<string, ConversationState> = {};
      convos.forEach((convo) => {
        convoStates[convo.id] = {
          hasMore: true,
          waitingForResponse: false,
        };
      });
      setConversationStates(convoStates);
      setConversations(convos);
    } catch (ex) {
      console.log(ex);
    }
  };

  return {
    getUserConversations,
  };
};

export default useGetUserConversations;
