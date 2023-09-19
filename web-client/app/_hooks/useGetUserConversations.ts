// import { GetConversationsQuery, GetConversationsDocument } from "@/graphql";
// import { useLazyQuery } from "@apollo/client";
import { ConversationState, toConversation } from "@/_models/Conversation";
import { useSetAtom } from "jotai";
import {
  conversationStatesAtom,
  userConversationsAtom,
} from "@/_helpers/JotaiWrapper";

const useGetUserConversations = () => {
  const setConversationStates = useSetAtom(conversationStatesAtom);
  const setConversations = useSetAtom(userConversationsAtom);
  // const [getConvos] = useLazyQuery<GetConversationsQuery>(
  // GetConversationsDocument
  // );

  const getUserConversations = async () => {
    // const results = await getConvos();
    // if (!results || !results.data || results.data.conversations.length === 0) {
    //   return;
    // }
    // const convos = results.data.conversations.map((e) => toConversation(e));
    // const convoStates: Record<string, ConversationState> = {};
    // convos.forEach((convo) => {
    //   convoStates[convo.id] = {
    //     hasMore: true,
    //     waitingForResponse: false,
    //   };
    // });
    // setConversationStates(convoStates);
    // setConversations(convos);
  };

  return {
    getUserConversations,
  };
};

export default useGetUserConversations;
