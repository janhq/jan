import { addHistoryMessagesAtom } from "@/_atoms/ChatMessageAtoms";
import {
  activeConversationAtom,
  getActiveConversationStateAtom,
  isActiveConvoHasMoreAtom,
  setConversationHasMoreAtom,
} from "@/_atoms/ConversationAtoms";
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
  const addOldChatMessages = useSetAtom(addHistoryMessagesAtom);
  const activeConvoState = useAtomValue(getActiveConversationStateAtom);
  const activeConvo = useAtomValue(activeConversationAtom);
  if (!activeConvo) {
    throw new Error("activeConversation is null");
  }
  const isHasMore = useAtomValue(isActiveConvoHasMoreAtom);
  const setConvoHasMore = useSetAtom(setConversationHasMoreAtom);
  const [getConversationMessages, { loading, error }] =
    useLazyQuery<GetConversationMessagesQuery>(GetConversationMessagesDocument);

  useEffect(() => {
    const hasMore = activeConvoState?.hasMore ?? true;
    if (!hasMore) return;

    const variables: GetConversationMessagesQueryVariables = {
      conversation_id: activeConvo.id,
      limit: MESSAGE_PER_PAGE,
      offset: offset,
    };

    getConversationMessages({ variables }).then((data) => {
      parseMessages(data.data?.messages ?? []).then((newMessages) => {
        const isHasMore = newMessages.length === MESSAGE_PER_PAGE;
        addOldChatMessages(newMessages);
        setConvoHasMore(activeConvo.id, isHasMore);
      });
    });
  }, [offset, activeConvo.id]);

  return {
    loading,
    error,
    hasMore: isHasMore,
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
