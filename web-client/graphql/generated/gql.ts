/* eslint-disable */
import * as types from './graphql';
import { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';

/**
 * Map of all GraphQL operations in the project.
 *
 * This map has several performance disadvantages:
 * 1. It is not tree-shakeable, so it will include all operations in the project.
 * 2. It is not minifiable, so the string of a GraphQL query will be multiple times inside the bundle.
 * 3. It does not support dead code elimination, so it will add unused operations.
 *
 * Therefore it is highly recommended to use the babel or swc plugin for production.
 */
const documents = {
    "fragment CollectionDetail on collections {\n  slug\n  name\n}": types.CollectionDetailFragmentDoc,
    "fragment ConversationDetail on conversations {\n  id\n  product_id\n  user_id\n  last_image_url\n  last_text_message\n  created_at\n  updated_at\n  conversation_product {\n    ...ProductDetail\n  }\n}": types.ConversationDetailFragmentDoc,
    "fragment MessageMedia on message_medias {\n  id\n  message_id\n  media_url\n  mime_type\n  updated_at\n}": types.MessageMediaFragmentDoc,
    "fragment MessageDetail on messages {\n  id\n  conversation_id\n  sender\n  sender_name\n  sender_avatar_url\n  content\n  message_type\n  message_sender_type\n  created_at\n  updated_at\n  status\n  message_medias {\n    ...MessageMedia\n  }\n}": types.MessageDetailFragmentDoc,
    "fragment ProductDetail on products {\n  id\n  name\n  slug\n  description\n  long_description\n  technical_description\n  image_url\n  author\n  greeting\n  source_url\n  version\n  inputs\n  outputs\n  nsfw\n  created_at\n  updated_at\n}": types.ProductDetailFragmentDoc,
    "fragment PromptDetail on prompts {\n  slug\n  content\n  image_url\n}": types.PromptDetailFragmentDoc,
    "mutation createConversation($data: conversations_insert_input!) {\n  insert_conversations_one(object: $data) {\n    ...ConversationDetail\n  }\n}": types.CreateConversationDocument,
    "mutation createMessage($data: messages_insert_input!) {\n  insert_messages_one(object: $data) {\n    ...MessageDetail\n  }\n}": types.CreateMessageDocument,
    "mutation deleteConversation($id: uuid!) {\n  delete_conversations_by_pk(id: $id) {\n    id\n  }\n}": types.DeleteConversationDocument,
    "mutation generateImage($model: String = \"\", $neg_prompt: String = \"\", $prompt: String = \"\", $seed: Int = 10, $steps: Int = 10, $width: Int = 512, $height: Int = 512) {\n  imageGeneration(\n    input: {model: $model, neg_prompt: $neg_prompt, prompt: $prompt, seed: $seed, steps: $steps, width: $width, height: $height}\n  ) {\n    url\n  }\n}": types.GenerateImageDocument,
    "mutation updateConversation($id: uuid!, $lastMessageText: String, $lastMessageUrl: String) {\n  update_conversations_by_pk(\n    pk_columns: {id: $id}\n    _set: {last_text_message: $lastMessageText, last_image_url: $lastMessageUrl}\n  ) {\n    ...ConversationDetail\n  }\n}": types.UpdateConversationDocument,
    "mutation updateMessage($id: uuid = \"\", $data: messages_set_input!) {\n  update_messages_by_pk(pk_columns: {id: $id}, _set: $data) {\n    ...MessageDetail\n  }\n}": types.UpdateMessageDocument,
    "query getCollections {\n  collections {\n    ...CollectionDetail\n    collection_products {\n      products {\n        ...ProductDetail\n        product_prompts {\n          prompts {\n            ...PromptDetail\n          }\n        }\n      }\n    }\n  }\n}": types.GetCollectionsDocument,
    "query getConversationMessages($conversation_id: uuid = \"\", $limit: Int = 100, $offset: Int = 100) {\n  messages(\n    offset: $offset\n    limit: $limit\n    where: {conversation_id: {_eq: $conversation_id}}\n    order_by: {created_at: desc}\n  ) {\n    ...MessageDetail\n  }\n}": types.GetConversationMessagesDocument,
    "query getConversations {\n  conversations(order_by: {updated_at: desc}) {\n    ...ConversationDetail\n    conversation_messages {\n      ...MessageDetail\n      message_medias {\n        ...MessageMedia\n      }\n    }\n  }\n}": types.GetConversationsDocument,
    "query getProductsByCollectionSlug($slug: String = \"\") {\n  products(where: {product_collections: {collections: {slug: {_eq: $slug}}}}) {\n    ...ProductDetail\n    product_prompts {\n      prompts {\n        ...PromptDetail\n      }\n    }\n    product_collections {\n      collections {\n        ...CollectionDetail\n      }\n    }\n  }\n}": types.GetProductsByCollectionSlugDocument,
    "query getProductPrompts($productSlug: String = \"\") {\n  prompts(where: {prompt_products: {products: {slug: {_eq: $productSlug}}}}) {\n    ...PromptDetail\n  }\n}": types.GetProductPromptsDocument,
    "query getProducts {\n  products {\n    ...ProductDetail\n    product_prompts {\n      prompts {\n        ...PromptDetail\n      }\n    }\n    product_collections {\n      collections {\n        ...CollectionDetail\n      }\n    }\n  }\n}": types.GetProductsDocument,
    "query getProductsIn($_in: [String!] = \"\") {\n  products(where: {slug: {_in: $_in}}) {\n    ...ProductDetail\n  }\n}": types.GetProductsInDocument,
    "subscription subscribeMessage($id: uuid = \"\") {\n  messages_by_pk(id: $id) {\n    id\n    content\n    status\n  }\n}": types.SubscribeMessageDocument,
};

/**
 * The gql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 *
 *
 * @example
 * ```ts
 * const query = gql(`query GetUser($id: ID!) { user(id: $id) { name } }`);
 * ```
 *
 * The query argument is unknown!
 * Please regenerate the types.
 */
export function gql(source: string): unknown;

/**
 * The gql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function gql(source: "fragment CollectionDetail on collections {\n  slug\n  name\n}"): (typeof documents)["fragment CollectionDetail on collections {\n  slug\n  name\n}"];
/**
 * The gql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function gql(source: "fragment ConversationDetail on conversations {\n  id\n  product_id\n  user_id\n  last_image_url\n  last_text_message\n  created_at\n  updated_at\n  conversation_product {\n    ...ProductDetail\n  }\n}"): (typeof documents)["fragment ConversationDetail on conversations {\n  id\n  product_id\n  user_id\n  last_image_url\n  last_text_message\n  created_at\n  updated_at\n  conversation_product {\n    ...ProductDetail\n  }\n}"];
/**
 * The gql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function gql(source: "fragment MessageMedia on message_medias {\n  id\n  message_id\n  media_url\n  mime_type\n  updated_at\n}"): (typeof documents)["fragment MessageMedia on message_medias {\n  id\n  message_id\n  media_url\n  mime_type\n  updated_at\n}"];
/**
 * The gql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function gql(source: "fragment MessageDetail on messages {\n  id\n  conversation_id\n  sender\n  sender_name\n  sender_avatar_url\n  content\n  message_type\n  message_sender_type\n  created_at\n  updated_at\n  status\n  message_medias {\n    ...MessageMedia\n  }\n}"): (typeof documents)["fragment MessageDetail on messages {\n  id\n  conversation_id\n  sender\n  sender_name\n  sender_avatar_url\n  content\n  message_type\n  message_sender_type\n  created_at\n  updated_at\n  status\n  message_medias {\n    ...MessageMedia\n  }\n}"];
/**
 * The gql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function gql(source: "fragment ProductDetail on products {\n  id\n  name\n  slug\n  description\n  long_description\n  technical_description\n  image_url\n  author\n  greeting\n  source_url\n  version\n  inputs\n  outputs\n  nsfw\n  created_at\n  updated_at\n}"): (typeof documents)["fragment ProductDetail on products {\n  id\n  name\n  slug\n  description\n  long_description\n  technical_description\n  image_url\n  author\n  greeting\n  source_url\n  version\n  inputs\n  outputs\n  nsfw\n  created_at\n  updated_at\n}"];
/**
 * The gql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function gql(source: "fragment PromptDetail on prompts {\n  slug\n  content\n  image_url\n}"): (typeof documents)["fragment PromptDetail on prompts {\n  slug\n  content\n  image_url\n}"];
/**
 * The gql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function gql(source: "mutation createConversation($data: conversations_insert_input!) {\n  insert_conversations_one(object: $data) {\n    ...ConversationDetail\n  }\n}"): (typeof documents)["mutation createConversation($data: conversations_insert_input!) {\n  insert_conversations_one(object: $data) {\n    ...ConversationDetail\n  }\n}"];
/**
 * The gql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function gql(source: "mutation createMessage($data: messages_insert_input!) {\n  insert_messages_one(object: $data) {\n    ...MessageDetail\n  }\n}"): (typeof documents)["mutation createMessage($data: messages_insert_input!) {\n  insert_messages_one(object: $data) {\n    ...MessageDetail\n  }\n}"];
/**
 * The gql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function gql(source: "mutation deleteConversation($id: uuid!) {\n  delete_conversations_by_pk(id: $id) {\n    id\n  }\n}"): (typeof documents)["mutation deleteConversation($id: uuid!) {\n  delete_conversations_by_pk(id: $id) {\n    id\n  }\n}"];
/**
 * The gql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function gql(source: "mutation generateImage($model: String = \"\", $neg_prompt: String = \"\", $prompt: String = \"\", $seed: Int = 10, $steps: Int = 10, $width: Int = 512, $height: Int = 512) {\n  imageGeneration(\n    input: {model: $model, neg_prompt: $neg_prompt, prompt: $prompt, seed: $seed, steps: $steps, width: $width, height: $height}\n  ) {\n    url\n  }\n}"): (typeof documents)["mutation generateImage($model: String = \"\", $neg_prompt: String = \"\", $prompt: String = \"\", $seed: Int = 10, $steps: Int = 10, $width: Int = 512, $height: Int = 512) {\n  imageGeneration(\n    input: {model: $model, neg_prompt: $neg_prompt, prompt: $prompt, seed: $seed, steps: $steps, width: $width, height: $height}\n  ) {\n    url\n  }\n}"];
/**
 * The gql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function gql(source: "mutation updateConversation($id: uuid!, $lastMessageText: String, $lastMessageUrl: String) {\n  update_conversations_by_pk(\n    pk_columns: {id: $id}\n    _set: {last_text_message: $lastMessageText, last_image_url: $lastMessageUrl}\n  ) {\n    ...ConversationDetail\n  }\n}"): (typeof documents)["mutation updateConversation($id: uuid!, $lastMessageText: String, $lastMessageUrl: String) {\n  update_conversations_by_pk(\n    pk_columns: {id: $id}\n    _set: {last_text_message: $lastMessageText, last_image_url: $lastMessageUrl}\n  ) {\n    ...ConversationDetail\n  }\n}"];
/**
 * The gql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function gql(source: "mutation updateMessage($id: uuid = \"\", $data: messages_set_input!) {\n  update_messages_by_pk(pk_columns: {id: $id}, _set: $data) {\n    ...MessageDetail\n  }\n}"): (typeof documents)["mutation updateMessage($id: uuid = \"\", $data: messages_set_input!) {\n  update_messages_by_pk(pk_columns: {id: $id}, _set: $data) {\n    ...MessageDetail\n  }\n}"];
/**
 * The gql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function gql(source: "query getCollections {\n  collections {\n    ...CollectionDetail\n    collection_products {\n      products {\n        ...ProductDetail\n        product_prompts {\n          prompts {\n            ...PromptDetail\n          }\n        }\n      }\n    }\n  }\n}"): (typeof documents)["query getCollections {\n  collections {\n    ...CollectionDetail\n    collection_products {\n      products {\n        ...ProductDetail\n        product_prompts {\n          prompts {\n            ...PromptDetail\n          }\n        }\n      }\n    }\n  }\n}"];
/**
 * The gql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function gql(source: "query getConversationMessages($conversation_id: uuid = \"\", $limit: Int = 100, $offset: Int = 100) {\n  messages(\n    offset: $offset\n    limit: $limit\n    where: {conversation_id: {_eq: $conversation_id}}\n    order_by: {created_at: desc}\n  ) {\n    ...MessageDetail\n  }\n}"): (typeof documents)["query getConversationMessages($conversation_id: uuid = \"\", $limit: Int = 100, $offset: Int = 100) {\n  messages(\n    offset: $offset\n    limit: $limit\n    where: {conversation_id: {_eq: $conversation_id}}\n    order_by: {created_at: desc}\n  ) {\n    ...MessageDetail\n  }\n}"];
/**
 * The gql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function gql(source: "query getConversations {\n  conversations(order_by: {updated_at: desc}) {\n    ...ConversationDetail\n    conversation_messages {\n      ...MessageDetail\n      message_medias {\n        ...MessageMedia\n      }\n    }\n  }\n}"): (typeof documents)["query getConversations {\n  conversations(order_by: {updated_at: desc}) {\n    ...ConversationDetail\n    conversation_messages {\n      ...MessageDetail\n      message_medias {\n        ...MessageMedia\n      }\n    }\n  }\n}"];
/**
 * The gql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function gql(source: "query getProductsByCollectionSlug($slug: String = \"\") {\n  products(where: {product_collections: {collections: {slug: {_eq: $slug}}}}) {\n    ...ProductDetail\n    product_prompts {\n      prompts {\n        ...PromptDetail\n      }\n    }\n    product_collections {\n      collections {\n        ...CollectionDetail\n      }\n    }\n  }\n}"): (typeof documents)["query getProductsByCollectionSlug($slug: String = \"\") {\n  products(where: {product_collections: {collections: {slug: {_eq: $slug}}}}) {\n    ...ProductDetail\n    product_prompts {\n      prompts {\n        ...PromptDetail\n      }\n    }\n    product_collections {\n      collections {\n        ...CollectionDetail\n      }\n    }\n  }\n}"];
/**
 * The gql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function gql(source: "query getProductPrompts($productSlug: String = \"\") {\n  prompts(where: {prompt_products: {products: {slug: {_eq: $productSlug}}}}) {\n    ...PromptDetail\n  }\n}"): (typeof documents)["query getProductPrompts($productSlug: String = \"\") {\n  prompts(where: {prompt_products: {products: {slug: {_eq: $productSlug}}}}) {\n    ...PromptDetail\n  }\n}"];
/**
 * The gql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function gql(source: "query getProducts {\n  products {\n    ...ProductDetail\n    product_prompts {\n      prompts {\n        ...PromptDetail\n      }\n    }\n    product_collections {\n      collections {\n        ...CollectionDetail\n      }\n    }\n  }\n}"): (typeof documents)["query getProducts {\n  products {\n    ...ProductDetail\n    product_prompts {\n      prompts {\n        ...PromptDetail\n      }\n    }\n    product_collections {\n      collections {\n        ...CollectionDetail\n      }\n    }\n  }\n}"];
/**
 * The gql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function gql(source: "query getProductsIn($_in: [String!] = \"\") {\n  products(where: {slug: {_in: $_in}}) {\n    ...ProductDetail\n  }\n}"): (typeof documents)["query getProductsIn($_in: [String!] = \"\") {\n  products(where: {slug: {_in: $_in}}) {\n    ...ProductDetail\n  }\n}"];
/**
 * The gql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function gql(source: "subscription subscribeMessage($id: uuid = \"\") {\n  messages_by_pk(id: $id) {\n    id\n    content\n    status\n  }\n}"): (typeof documents)["subscription subscribeMessage($id: uuid = \"\") {\n  messages_by_pk(id: $id) {\n    id\n    content\n    status\n  }\n}"];

export function gql(source: string) {
  return (documents as any)[source] ?? {};
}

export type DocumentType<TDocumentNode extends DocumentNode<any, any>> = TDocumentNode extends DocumentNode<  infer TType,  any>  ? TType  : never;