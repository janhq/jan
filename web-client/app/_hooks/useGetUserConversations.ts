import { Conversation, ConversationState } from "@/_models/Conversation";
import { useSetAtom } from "jotai";
import {
  conversationStatesAtom,
  userConversationsAtom,
} from "@/_helpers/JotaiWrapper";
import { invoke } from "@/_services/pluginService";

const useGetUserConversations = () => {
  const setConversationStates = useSetAtom(conversationStatesAtom);
  const setConversations = useSetAtom(userConversationsAtom);

  const getUserConversations = async () => {
    try {
      const convos: Conversation[] = await invoke("getConversations");
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
