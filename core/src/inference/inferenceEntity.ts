/**
 * The `MessageRequest` type defines the shape of a new message request object.
 * @data_transfer_object
 */
export interface ChatCompletionMessage {
  /** The contents of the message. **/
  content?: string
  /** The role of the author of this message. **/
  role: ChatCompletionRole
}

/**
 * The role of the author of this message.
 */
export enum ChatCompletionRole {
  System = 'system',
  Assistant = 'assistant',
  User = 'user',
}
