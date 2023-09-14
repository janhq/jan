import { Conversation, ConversationState } from "@/_models/Conversation";
import { atom } from "jotai";

/**
 * Stores all conversations of current user
 */
export const conversationsAtom = atom<Conversation[]>([]);

/**
 * Store all conversation states
 */
const conversationStatesAtom = atom<ConversationState[]>([]);

/**
 * Get conversation states
 */
export const getConversationStateAtom = atom((get) => {
  return get(conversationStatesAtom);
});

export const getActiveConversationStateAtom = atom((get) => {
  const activeConvoId = get(activeConversationIdAtom);
  if (!activeConvoId) return undefined;
  return get(conversationStatesAtom).find((c) => c.id === activeConvoId);
});

/**
 * Stores the id of the currently active conversation
 */
export const activeConversationIdAtom = atom<string | undefined>(undefined);

/**
 * Read atom for the currently active conversation
 */
export const activeConversationAtom = atom<Conversation | undefined>((get) =>
  get(conversationsAtom).find((c) => c.id === get(activeConversationIdAtom))
);

/**
 * Used to remove a conversation from the list of conversations
 */
export const removeConversationAtom = atom(null, (get, set, id: string) => {
  const conversations = get(conversationsAtom);
  const newConversations = conversations.filter((c) => c.id !== id);
  set(conversationsAtom, newConversations);
});

/**
 * Used to add a new conversation to the list of conversations. Also sets the new conversation as active.
 */
export const createNewConversationAtom = atom(
  null,
  (get, set, newConversation: Conversation) => {
    // add new convo to list
    const currentConversations = get(conversationsAtom);
    set(conversationsAtom, [...currentConversations, newConversation]);

    // add new convo states
    const newConvoState: ConversationState = {
      id: newConversation.id,
      hasMore: true,
      waitingForResponse: false,
    };
    const currentConvoStates = get(conversationStatesAtom);
    set(conversationStatesAtom, [...currentConvoStates, newConvoState]);

    // set active convo id
    set(activeConversationIdAtom, newConversation.id);
  }
);

/**
 * Used when user fetch all conversations
 */
export const setConversationsAtom = atom(
  null,
  (get, set, newConversations: Conversation[]) => {
    set(conversationsAtom, newConversations);

    // create corresponding conversation states
    const newStates: ConversationState[] = newConversations.map((c) => {
      return {
        id: c.id,
        hasMore: true,
        waitingForResponse: false,
      };
    });
    set(conversationStatesAtom, newStates);
  }
);

/**
 * Update the waiting state of a conversation
 */
export const setConvoWaitingStateAtom = atom(
  null,
  (get, set, convoId: string, waitingForResponse: boolean) => {
    const currentState = get(conversationStatesAtom).find(
      (c) => c.id === convoId
    );
    if (!currentState) return;
    const newState = { ...currentState, waitingForResponse };
    const allNewState = get(conversationStatesAtom).map((c) => {
      if (c.id === convoId) return newState;
      return c;
    });
    set(conversationStatesAtom, allNewState);
  }
);

export const setConversationLastMessageAtom = atom(
  null,
  (get, set, convoId: string, lastMessage: string) => {
    const convo = get(conversationsAtom).find((c) => c.id === convoId);
    if (!convo) return;
    const newConvo = { ...convo, lastTextMessage: lastMessage };
    const newConversations = get(conversationsAtom).map((c) => {
      if (c.id === convoId) return newConvo;
      return c;
    });
    set(conversationsAtom, newConversations);
  }
);

export const setConversationLastImageAtom = atom(
  null,
  (get, set, convoId: string, lastImage: string) => {
    const convo = get(conversationsAtom).find((c) => c.id === convoId);
    if (!convo) return;
    const newConvo = { ...convo, lastImageMessage: lastImage };
    const newConversations = get(conversationsAtom).map((c) => {
      if (c.id === convoId) return newConvo;
      return c;
    });
    set(conversationsAtom, newConversations);
  }
);

export const setConversationHasMoreAtom = atom(
  null,
  (get, set, convoId: string, hasMore: boolean) => {
    const currentState = get(conversationStatesAtom).find(
      (c) => c.id === convoId
    );
    if (!currentState) return;
    const newState = { ...currentState, hasMore };
    console.info("setConversationHasMore", newState);
    const allNewState = get(conversationStatesAtom).map((c) => {
      if (c.id === convoId) return newState;
      return c;
    });
    set(conversationStatesAtom, allNewState);
  }
);

export const isActiveConvoHasMoreAtom = atom((get) => {
  const activeConvoId = get(activeConversationIdAtom);
  if (!activeConvoId) return false;
  const activeConvoState = get(conversationStatesAtom).find(
    (c) => c.id === activeConvoId
  );
  if (!activeConvoState) return false;
  console.info("isActiveConvoHasMoreAtom", activeConvoState.hasMore);
  return activeConvoState.hasMore;
});
