import { ContentType, ContentValue } from '../message'

/**
 * The role of the author of this message.
 */
export enum ChatCompletionRole {
  System = 'system',
  Assistant = 'assistant',
  User = 'user',
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
}

export type ChatCompletionMessageContent =
  | string
  | (ChatCompletionMessageContentText & ChatCompletionMessageContentImage)[]

export enum ChatCompletionMessageContentType {
  Text = 'text',
  Image = 'image_url',
}

export type ChatCompletionMessageContentText = {
  type: ChatCompletionMessageContentType
  text: string
}
export type ChatCompletionMessageContentImage = {
  type: ChatCompletionMessageContentType
  image_url: { url: string }
}
