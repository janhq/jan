import {
  addOldMessagesAtom,
  conversationStatesAtom,
  currentConversationAtom,
  updateConversationHasMoreAtom,
} from "@/_helpers/JotaiWrapper";
import { ChatMessage, toChatMessage } from "@/_models/ChatMessage";
import { MESSAGE_PER_PAGE } from "@/_utils/const";
import {
  GetConversationMessagesQuery,
  GetConversationMessagesDocument,
  GetConversationMessagesQueryVariables,
  MessageDetailFragment,
} from "@/graphql";
import { useLazyQuery } from "@apollo/client";
import { useAtomValue, useSetAtom } from "jotai";
import { useEffect } from "react";

/**
 * Custom hooks to get chat messages for current(active) conversation
 *
 * @param offset for pagination purpose
 * @returns
 */
const useChatMessages = (offset = 0) => {
  const addOldChatMessages = useSetAtom(addOldMessagesAtom);
  const currentConvo = useAtomValue(currentConversationAtom);
  if (!currentConvo) {
    throw new Error("activeConversation is null");
  }
  const convoStates = useAtomValue(conversationStatesAtom);
  const updateConvoHasMore = useSetAtom(updateConversationHasMoreAtom);
  const [getConversationMessages, { loading, error }] =
    useLazyQuery<GetConversationMessagesQuery>(GetConversationMessagesDocument);

  useEffect(() => {
    const hasMore = convoStates[currentConvo.id]?.hasMore ?? true;
    if (!hasMore) return;

    const variables: GetConversationMessagesQueryVariables = {
      conversation_id: currentConvo.id,
      limit: MESSAGE_PER_PAGE,
      offset: offset,
    };

    getConversationMessages({ variables }).then((data) => {
      parseMessages(data.data?.messages ?? []).then((newMessages) => {
        const isHasMore = newMessages.length === MESSAGE_PER_PAGE;
        addOldChatMessages(newMessages);
        updateConvoHasMore(currentConvo.id, isHasMore);
      });
    });
  }, [offset, currentConvo.id]);

  return {
    loading,
    error,
    hasMore: convoStates[currentConvo.id]?.hasMore ?? true,
  };
};

async function parseMessages(
  messages: MessageDetailFragment[]
): Promise<ChatMessage[]> {
  const newMessages: ChatMessage[] = [];
  for (const m of messages) {
    const chatMessage = await toChatMessage(m);
    newMessages.push(chatMessage);
  }
  return newMessages;
}

export default useChatMessages;
