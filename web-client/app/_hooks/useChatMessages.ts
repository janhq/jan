import {
  addOldMessagesAtom,
  conversationStatesAtom,
  currentConversationAtom,
  updateConversationHasMoreAtom,
} from "@/_helpers/JotaiWrapper";
import { ChatMessage, RawMessage, toChatMessage } from "@/_models/ChatMessage";
import { executeSerial } from "@/_services/pluginService";
import { useAtomValue, useSetAtom } from "jotai";
import { useEffect, useState } from "react";
import { DataService } from "../../shared/coreService";

/**
 * Custom hooks to get chat messages for current(active) conversation
 *
 * @param offset for pagination purpose
 * @returns
 */
const useChatMessages = (offset = 0) => {
  const [loading, setLoading] = useState(true);
  const addOldChatMessages = useSetAtom(addOldMessagesAtom);
  const currentConvo = useAtomValue(currentConversationAtom);
  if (!currentConvo) {
    throw new Error("activeConversation is null");
  }
  const convoStates = useAtomValue(conversationStatesAtom);
  const updateConvoHasMore = useSetAtom(updateConversationHasMoreAtom);

  useEffect(() => {
    const hasMore = convoStates[currentConvo.id ?? ""]?.hasMore ?? true;
    if (!hasMore) return;

    const getMessages = async () => {
      executeSerial(
        DataService.GET_CONVERSATION_MESSAGES,
        currentConvo.id
      ).then((data) => {
        if (!data) {
          return;
        }
        parseMessages(data ?? []).then((newMessages) => {
          addOldChatMessages(newMessages);
          updateConvoHasMore(currentConvo.id ?? "", false);
          setLoading(false);
        });
      });
    };
    getMessages();
  }, [
    offset,
    currentConvo.id,
    convoStates,
    addOldChatMessages,
    updateConvoHasMore,
  ]);

  return {
    loading: loading,
    error: undefined,
    hasMore: convoStates[currentConvo.id ?? ""]?.hasMore ?? true,
  };
};

async function parseMessages(messages: RawMessage[]): Promise<ChatMessage[]> {
  const newMessages: ChatMessage[] = [];
  for (const m of messages) {
    const chatMessage = await toChatMessage(m);
    newMessages.push(chatMessage);
  }
  return newMessages;
}

export default useChatMessages;
