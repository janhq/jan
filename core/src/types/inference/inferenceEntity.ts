import { ContentType, ContentValue } from '../message'

/**
 * The role of the author of this message.
 */
export enum ChatCompletionRole {
  System = 'system',
  Assistant = 'assistant',
  User = 'user',
  Tool = 'tool',
}

/**
 * The `MessageRequest` type defines the shape of a new message request object.
 * @data_transfer_object
 */
export type ChatCompletionMessage = {
  /** The contents of the message. **/
  content?: ChatCompletionMessageContent
  /** The role of the author of this message. **/
  role: ChatCompletionRole
  type?: string
  output?: string
  tool_call_id?: string
}

export type ChatCompletionMessageContent =
  | string
  | (ChatCompletionMessageContentText &
      ChatCompletionMessageContentImage &
      ChatCompletionMessageContentDoc)[]

export enum ChatCompletionMessageContentType {
  Text = 'text',
  Image = 'image_url',
  Doc = 'doc_url',
}

export type ChatCompletionMessageContentText = {
  type: ChatCompletionMessageContentType
  text: string
}
export type ChatCompletionMessageContentImage = {
  type: ChatCompletionMessageContentType
  image_url: { url: string }
}
export type ChatCompletionMessageContentDoc = {
  type: ChatCompletionMessageContentType
  doc_url: { url: string }
}
