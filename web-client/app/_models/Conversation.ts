import { Instance, castToSnapshot, types } from "mobx-state-tree";
import { Product } from "./Product";
import { ChatMessage } from "./ChatMessage";
import { User } from "../_models/User";
import { withSetPropAction } from "../_helpers/withSetPropAction";
import { mergeAndRemoveDuplicates } from "../_utils/message";

export const Conversation = types
  .model("Conversation", {
    /**
     * Unique identifier for the conversation
     */
    id: types.string,

    /**
     * AI model that the conversation is using
     */
    product: Product,

    /**
     * Conversation's messages, should ordered by time (createdAt)
     */
    chatMessages: types.optional(types.array(ChatMessage), []),

    /**
     * User who initiate the chat with the above AI model
     */
    user: User,

    /**
     * Indicates whether the conversation is created by the user
     */
    createdAt: types.number,

    /**
     * Time the last message is sent
     */
    updatedAt: types.maybe(types.number),

    /**
     * Last image url sent by the model if any
     */
    lastImageUrl: types.maybe(types.string),

    /**
     * Last text sent by the user if any
     */
    lastTextMessage: types.maybe(types.string),
  })
  .volatile(() => ({
    isFetching: false,
    offset: 0,
    hasMore: true,
    isWaitingForModelResponse: false,
  }))
  .actions(withSetPropAction)
  .actions((self) => ({
    addMessage(message: Instance<typeof ChatMessage>) {
      self.chatMessages.push(message);
    },

    pushMessages(messages: Instance<typeof ChatMessage>[]) {
      const mergedMessages = mergeAndRemoveDuplicates(
        self.chatMessages,
        messages
      );

      self.chatMessages = castToSnapshot(mergedMessages);
    },

    setHasMore(hasMore: boolean) {
      self.hasMore = hasMore;
    },

    setWaitingForModelResponse(isWaitingForModelResponse: boolean) {
      self.isWaitingForModelResponse = isWaitingForModelResponse;
    },
  }));
