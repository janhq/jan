import { atom } from "jotai";
import { MainViewState, setMainViewStateAtom } from "./MainView.atom";
import { Conversation, ConversationState } from "@/_models/Conversation";

/**
 * Stores the current active conversation id.
 */
const activeConversationIdAtom = atom<string | undefined>(undefined);

export const getActiveConvoIdAtom = atom((get) =>
  get(activeConversationIdAtom)
);

export const setActiveConvoIdAtom = atom(
  null,
  (_get, set, convoId: string | undefined) => {
    if (convoId) {
      console.debug(`Set active conversation id: ${convoId}`);
      set(setMainViewStateAtom, MainViewState.Conversation);
    }

    set(activeConversationIdAtom, convoId);
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
 * Stores all conversations for the current user
 */
export const userConversationsAtom = atom<Conversation[]>([]);
export const currentConversationAtom = atom<Conversation | undefined>((get) =>
  get(userConversationsAtom).find((c) => c.id === get(getActiveConvoIdAtom))
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
