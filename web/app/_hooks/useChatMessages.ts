import { ChatMessage, RawMessage, toChatMessage } from "@/_models/ChatMessage";
import { executeSerial } from "@/_services/pluginService";
import { useAtomValue, useSetAtom } from "jotai";
import { useEffect, useState } from "react";
import { DataService } from "@janhq/core";
import { addOldMessagesAtom } from "@/_helpers/atoms/ChatMessage.atom";
import {
  currentConversationAtom,
  conversationStatesAtom,
  updateConversationHasMoreAtom,
} from "@/_helpers/atoms/Conversation.atom";

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
  const convoStates = useAtomValue(conversationStatesAtom);
  const updateConvoHasMore = useSetAtom(updateConversationHasMoreAtom);

  useEffect(() => {
    if (!currentConvo) {
      return;
    }
    const hasMore = convoStates[currentConvo._id ?? ""]?.hasMore ?? true;
    if (!hasMore) return;

    const getMessages = async () => {
      executeSerial(DataService.GetConversationMessages, currentConvo._id).then((data: any) => {
        if (!data) {
          return;
        }
        const newMessages = parseMessages(data ?? []);
        addOldChatMessages(newMessages);
        updateConvoHasMore(currentConvo._id ?? "", false);
        setLoading(false);
      });
    };
    getMessages();
  }, [offset, currentConvo?._id, convoStates, addOldChatMessages, updateConvoHasMore]);

  return {
    loading: loading,
    error: undefined,
    hasMore: convoStates[currentConvo?._id ?? ""]?.hasMore ?? true,
  };
};

function parseMessages(messages: RawMessage[]): ChatMessage[] {
  const newMessages: ChatMessage[] = [];
  for (const m of messages) {
    const chatMessage = toChatMessage(m);
    newMessages.push(chatMessage);
  }
  return newMessages;
}

export default useChatMessages;
