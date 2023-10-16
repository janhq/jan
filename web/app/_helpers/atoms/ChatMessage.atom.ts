import { ChatMessage, MessageStatus } from "@/_models/ChatMessage";
import { atom } from "jotai";
import { getActiveConvoIdAtom } from "./Conversation.atom";

/**
 * Stores all chat messages for all conversations
 */
export const chatMessages = atom<Record<string, ChatMessage[]>>({});

export const currentChatMessagesAtom = atom<ChatMessage[]>((get) => {
  const activeConversationId = get(getActiveConvoIdAtom);
  if (!activeConversationId) return [];
  return get(chatMessages)[activeConversationId] ?? [];
});

export const addOldMessagesAtom = atom(
  null,
  (get, set, newMessages: ChatMessage[]) => {
    const currentConvoId = get(getActiveConvoIdAtom);
    if (!currentConvoId) return;

    const currentMessages = get(chatMessages)[currentConvoId] ?? [];
    const updatedMessages = [...currentMessages, ...newMessages];

    const newData: Record<string, ChatMessage[]> = {
      ...get(chatMessages),
    };
    newData[currentConvoId] = updatedMessages;
    set(chatMessages, newData);
  }
);

export const addNewMessageAtom = atom(
  null,
  (get, set, newMessage: ChatMessage) => {
    const currentConvoId = get(getActiveConvoIdAtom);
    if (!currentConvoId) return;

    const currentMessages = get(chatMessages)[currentConvoId] ?? [];
    const updatedMessages = [newMessage, ...currentMessages];

    const newData: Record<string, ChatMessage[]> = {
      ...get(chatMessages),
    };
    newData[currentConvoId] = updatedMessages;
    set(chatMessages, newData);
  }
);

export const deleteConversationMessage = atom(null, (get, set, id: string) => {
  const newData: Record<string, ChatMessage[]> = {
    ...get(chatMessages),
  };
  newData[id] = [];
  set(chatMessages, newData);
});

export const updateMessageAtom = atom(
  null,
  (get, set, id: string, conversationId: string, text: string) => {
    const messages = get(chatMessages)[conversationId] ?? [];
    const message = messages.find((e) => e.id === id);
    if (message) {
      message.text = text;
      const updatedMessages = [...messages];

      const newData: Record<string, ChatMessage[]> = {
        ...get(chatMessages),
      };
      newData[conversationId] = updatedMessages;
      set(chatMessages, newData);
    }
  }
);

/**
 * For updating the status of the last AI message that is pending
 */
export const updateLastMessageAsReadyAtom = atom(
  null,
  (get, set, id, text: string) => {
    const currentConvoId = get(getActiveConvoIdAtom);
    if (!currentConvoId) return;

    const currentMessages = get(chatMessages)[currentConvoId] ?? [];
    const messageToUpdate = currentMessages.find((e) => e.id === id);

    // if message is not found, do nothing
    if (!messageToUpdate) return;

    const index = currentMessages.indexOf(messageToUpdate);
    const updatedMsg: ChatMessage = {
      ...messageToUpdate,
      status: MessageStatus.Ready,
      text: text,
    };

    currentMessages[index] = updatedMsg;
    const newData: Record<string, ChatMessage[]> = {
      ...get(chatMessages),
    };
    newData[currentConvoId] = currentMessages;
    set(chatMessages, newData);
  }
);
