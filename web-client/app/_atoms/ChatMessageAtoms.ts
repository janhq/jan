import { ChatMessage, MessageStatus } from "@/_models/ChatMessage";
import { atom } from "jotai";
import {
  activeConversationIdAtom,
  conversationsAtom,
} from "./ConversationAtoms";
import { mergeAndRemoveDuplicates } from "@/_utils/message";

/**
 * Stores all chat messages for all conversations
 */
export const chatMessagesAtom = atom<Record<string, ChatMessage[]>>({});

/**
 * Get active conversation messages
 */
export const getActiveChatMessagesAtom = atom<ChatMessage[]>((get) => {
  const convoId = get(activeConversationIdAtom);
  if (!convoId) return [];
  return get(chatMessagesAtom)[convoId] ?? [];
});

/**
 * Used when add a new single chat message to the list of chat messages
 */
export const addNewChatMessageToActiveConvoAtom = atom(
  null,
  (get, set, newMessage: ChatMessage) => {
    const convoId = get(activeConversationIdAtom);
    if (!convoId) {
      console.error("activeConvoId is null");
      return;
    }

    const currentMessages = get(chatMessagesAtom)[convoId] ?? [];
    const updatedMessages = [newMessage, ...currentMessages];

    const newData = { ...get(chatMessagesAtom) };
    newData[convoId] = updatedMessages;

    set(chatMessagesAtom, newData);

    // update state of conversation
    const convo = get(conversationsAtom).find((c) => c.id === convoId);
    if (!convo) return;
    const newConvo = { ...convo, updatedAt: Date.now() };
    const newConversations = get(conversationsAtom).filter(
      (c) => c.id !== convoId
    );
    set(conversationsAtom, [newConvo, ...newConversations]);
  }
);

/**
 * Used when add a new list of history chat messages to the list of chat messages
 */
export const addHistoryMessagesAtom = atom(
  null,
  (get, set, newMessages: ChatMessage[]) => {
    const currentConvoId = get(activeConversationIdAtom);
    if (!currentConvoId) return;

    const currentMessages = get(chatMessagesAtom)[currentConvoId] ?? [];
    const updatedMessages = mergeAndRemoveDuplicates(
      currentMessages,
      newMessages
    );

    const newData: Record<string, ChatMessage[]> = {
      ...get(chatMessagesAtom),
    };
    newData[currentConvoId] = updatedMessages;
    set(chatMessagesAtom, newData);
  }
);

export const updateLastMessageAsReadyAtom = atom(
  null,
  (get, set, convoId: string, id: string, text: string) => {
    const currentMessages = get(chatMessagesAtom)[convoId] ?? [];
    const messageToUpdate = currentMessages.find((e) => e.id === id);

    // if message is not found, do nothing
    if (!messageToUpdate) return;

    const index = currentMessages.indexOf(messageToUpdate);
    const updatedMsg: ChatMessage = {
      ...messageToUpdate,
      status: MessageStatus.Ready,
      text,
    };

    currentMessages[index] = updatedMsg;
    const newData: Record<string, ChatMessage[]> = {
      ...get(chatMessagesAtom),
    };
    newData[convoId] = currentMessages;
    set(chatMessagesAtom, newData);
  }
);
