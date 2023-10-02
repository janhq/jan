"use client";

import { ChatMessage, MessageStatus } from "@/_models/ChatMessage";
import { Conversation, ConversationState } from "@/_models/Conversation";
import { DownloadState } from "@/_models/DownloadState";
import { Product } from "@/_models/Product";
import { Provider, atom } from "jotai";
import { ReactNode } from "react";

type Props = {
  children: ReactNode;
};

export default function JotaiWrapper({ children }: Props) {
  return <Provider>{children}</Provider>;
}

const activeConversationIdAtom = atom<string | undefined>(undefined);
export const getActiveConvoIdAtom = atom((get) =>
  get(activeConversationIdAtom)
);
export const setActiveConvoIdAtom = atom(
  null,
  (_get, set, convoId: string | undefined) => {
    if (convoId) {
      console.log(`set active convo id to ${convoId}`);
      set(setMainViewStateAtom, MainViewState.Conversation);
    }
    set(activeConversationIdAtom, convoId);
  }
);

export const currentPromptAtom = atom<string>("");

export const showingAdvancedPromptAtom = atom<boolean>(false);
export const showingProductDetailAtom = atom<boolean>(false);
export const showingMobilePaneAtom = atom<boolean>(false);
export const showingTyping = atom<boolean>(false);

export const appDownloadProgress = atom<number>(-1);
export const searchingModelText = atom<string>("");

/**
 * Stores all conversations for the current user
 */
export const userConversationsAtom = atom<Conversation[]>([]);
export const currentConversationAtom = atom<Conversation | undefined>((get) =>
  get(userConversationsAtom).find((c) => c.id === get(activeConversationIdAtom))
);
export const setConvoUpdatedAtAtom = atom(null, (get, set, convoId: string) => {
  const convo = get(userConversationsAtom).find((c) => c.id === convoId);
  if (!convo) return;
  const newConvo: Conversation = {
    ...convo,
    updated_at: new Date().toISOString(),
  };
  const newConversations: Conversation[] = get(userConversationsAtom).map((c) =>
    c.id === convoId ? newConvo : c
  );

  set(userConversationsAtom, newConversations);
});

export const currentStreamingMessageAtom = atom<ChatMessage | undefined>(
  undefined
);

export const setConvoLastImageAtom = atom(
  null,
  (get, set, convoId: string, lastImageUrl: string) => {
    const convo = get(userConversationsAtom).find((c) => c.id === convoId);
    if (!convo) return;
    const newConvo: Conversation = { ...convo };
    const newConversations: Conversation[] = get(userConversationsAtom).map(
      (c) => (c.id === convoId ? newConvo : c)
    );

    set(userConversationsAtom, newConversations);
  }
);

/**
 * Stores all conversation states for the current user
 */
export const conversationStatesAtom = atom<Record<string, ConversationState>>(
  {}
);
export const currentConvoStateAtom = atom<ConversationState | undefined>(
  (get) => {
    const activeConvoId = get(activeConversationIdAtom);
    if (!activeConvoId) {
      console.log("active convo id is undefined");
      return undefined;
    }

    return get(conversationStatesAtom)[activeConvoId];
  }
);
export const addNewConversationStateAtom = atom(
  null,
  (get, set, conversationId: string, state: ConversationState) => {
    const currentState = { ...get(conversationStatesAtom) };
    currentState[conversationId] = state;
    set(conversationStatesAtom, currentState);
  }
);
export const updateConversationWaitingForResponseAtom = atom(
  null,
  (get, set, conversationId: string, waitingForResponse: boolean) => {
    const currentState = { ...get(conversationStatesAtom) };
    currentState[conversationId] = {
      ...currentState[conversationId],
      waitingForResponse,
    };
    set(conversationStatesAtom, currentState);
  }
);
export const updateConversationHasMoreAtom = atom(
  null,
  (get, set, conversationId: string, hasMore: boolean) => {
    const currentState = { ...get(conversationStatesAtom) };
    currentState[conversationId] = { ...currentState[conversationId], hasMore };
    set(conversationStatesAtom, currentState);
  }
);

/**
 * Stores all chat messages for all conversations
 */
export const chatMessages = atom<Record<string, ChatMessage[]>>({});
export const currentChatMessagesAtom = atom<ChatMessage[]>((get) => {
  const activeConversationId = get(activeConversationIdAtom);
  if (!activeConversationId) return [];
  return get(chatMessages)[activeConversationId] ?? [];
});

export const addOldMessagesAtom = atom(
  null,
  (get, set, newMessages: ChatMessage[]) => {
    const currentConvoId = get(activeConversationIdAtom);
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
    const currentConvoId = get(activeConversationIdAtom);
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
    const currentConvoId = get(activeConversationIdAtom);
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

export const currentProductAtom = atom<Product | undefined>(undefined);

export const searchAtom = atom<string>("");

// modal atoms
export const showConfirmDeleteConversationModalAtom = atom(false);
export const showConfirmSignOutModalAtom = atom(false);
export const showConfirmDeleteModalAtom = atom(false);

export type FileDownloadStates = {
  [key: string]: DownloadState;
};

// main view state
export enum MainViewState {
  Welcome,
  ExploreModel,
  MyModel,
  ResourceMonitor,
  Setting,
  Conversation,
}

const systemBarVisibilityAtom = atom<boolean>(true);
export const getSystemBarVisibilityAtom = atom((get) =>
  get(systemBarVisibilityAtom)
);

const currentMainViewStateAtom = atom<MainViewState>(MainViewState.Welcome);
export const getMainViewStateAtom = atom((get) =>
  get(currentMainViewStateAtom)
);

export const setMainViewStateAtom = atom(
  null,
  (get, set, state: MainViewState) => {
    if (get(getMainViewStateAtom) === state) return;
    if (state !== MainViewState.Conversation) {
      set(activeConversationIdAtom, undefined);
    }
    const showSystemBar = state !== MainViewState.Conversation;
    set(systemBarVisibilityAtom, showSystemBar);
    set(currentMainViewStateAtom, state);
  }
);

// download states
export const modelDownloadStateAtom = atom<FileDownloadStates>({});

export const setDownloadStateAtom = atom(
  null,
  (get, set, state: DownloadState) => {
    const currentState = { ...get(modelDownloadStateAtom) };
    console.debug(
      `current download state for ${state.fileName} is ${JSON.stringify(state)}`
    );
    currentState[state.fileName] = state;
    set(modelDownloadStateAtom, currentState);
  }
);

export const setDownloadStateSuccessAtom = atom(
  null,
  (get, set, fileName: string) => {
    const currentState = { ...get(modelDownloadStateAtom) };
    const state = currentState[fileName];
    if (!state) {
      console.error(`Cannot find download state for ${fileName}`);
      return;
    }

    delete currentState[fileName];
    set(modelDownloadStateAtom, currentState);
  }
);
