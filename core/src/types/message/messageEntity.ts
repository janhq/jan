import {
  ChatCompletionMessageParam as OpenAiChatCompletionMessageParam,
  ChatCompletionMessage as OpenAiChatCompletionMessage,
} from 'openai/resources'
import {
  MessageCreateParams as OpenAiMessageCreateParams,
  Message as OpenAiMessage,
  MessageContent as OpenAiMessageContent,
  TextContentBlock as OpenAiTextContentBlock,
} from 'openai/resources/beta/threads/messages'

export interface Message extends OpenAiMessage {}

export type MessageContent = OpenAiMessageContent

export type TextContentBlock = OpenAiTextContentBlock

export interface MessageIncompleteDetails extends OpenAiMessage.IncompleteDetails {}

export interface MessageAttachment extends OpenAiMessage.Attachment {}

export interface ChatCompletionMessage extends OpenAiChatCompletionMessage {}

export type ChatCompletionMessageParam = OpenAiChatCompletionMessageParam

export interface MessageCreateParams extends OpenAiMessageCreateParams {}
