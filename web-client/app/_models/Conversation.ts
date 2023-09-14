import { ConversationDetailFragment } from "@/graphql";
import { Product, toProduct } from "./Product";

export interface Conversation {
  id: string;
  product: Product;
  createdAt: number;
  updatedAt?: number;
  lastImageUrl?: string;
  lastTextMessage?: string;
}

/**
 * Store the state of conversation like fetching, waiting for response, etc.
 */
export type ConversationState = {
  id: string;
  hasMore: boolean;
  waitingForResponse: boolean;
};

export const toConversation = (
  convo: ConversationDetailFragment
): Conversation => {
  const product = convo.conversation_product;
  if (!product) {
    throw new Error("Product is not defined");
  }
  return {
    id: convo.id,
    product: toProduct(product),
    lastImageUrl: convo.last_image_url ?? undefined,
    lastTextMessage: convo.last_text_message ?? undefined,
    createdAt: new Date(convo.created_at).getTime(),
    updatedAt: convo.updated_at
      ? new Date(convo.updated_at).getTime()
      : undefined,
  };
};
