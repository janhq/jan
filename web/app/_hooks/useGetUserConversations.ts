import { Conversation, ConversationState } from "@/_models/Conversation";
import { useSetAtom } from "jotai";
import { executeSerial } from "@/_services/pluginService";
import { DataService } from "@janhq/plugin-core";
import {
  conversationStatesAtom,
  userConversationsAtom,
} from "@/_helpers/atoms/Conversation.atom";

const useGetUserConversations = () => {
  const setConversationStates = useSetAtom(conversationStatesAtom);
  const setConversations = useSetAtom(userConversationsAtom);

  const getUserConversations = async () => {
    try {
      const convos: Conversation[] | undefined = await executeSerial(
        DataService.GetConversations
      );
      const convoStates: Record<string, ConversationState> = {};
      convos?.forEach((convo) => {
        convoStates[convo._id ?? ""] = {
          hasMore: true,
          waitingForResponse: false,
        };
      });
      setConversationStates(convoStates);
      setConversations(convos ?? []);
    } catch (ex) {
      console.log(ex);
    }
  };

  return {
    getUserConversations,
  };
};

export default useGetUserConversations;
