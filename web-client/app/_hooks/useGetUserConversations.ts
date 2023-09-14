import { GetConversationsQuery, GetConversationsDocument } from "@/graphql";
import { useLazyQuery } from "@apollo/client";
import { toConversation } from "@/_models/Conversation";
import { useSetAtom } from "jotai";
import { setConversationsAtom } from "@/_atoms/ConversationAtoms";

const useGetUserConversations = () => {
  const setConversations = useSetAtom(setConversationsAtom);
  const [getConvos] = useLazyQuery<GetConversationsQuery>(
    GetConversationsDocument
  );

  const getUserConversations = async () => {
    const results = await getConvos();
    if (!results || !results.data || results.data.conversations.length === 0) {
      return;
    }

    const convos = results.data.conversations.map((e) => toConversation(e));
    setConversations(convos);
  };

  return {
    getUserConversations,
  };
};

export default useGetUserConversations;
