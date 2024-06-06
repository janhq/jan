import {
  ChatCompletionCreateParamsNonStreaming as OpenAiChatCompletionCreateParamsNonStreaming,
  ChatCompletionCreateParamsStreaming as OpenAiChatCompletionCreateParamsStreaming,
} from 'openai/resources/chat/completions'

export interface ChatCompletionCreateParamsNonStreaming
  extends OpenAiChatCompletionCreateParamsNonStreaming {}

export interface ChatCompletionCreateParamsStreaming
  extends OpenAiChatCompletionCreateParamsStreaming {}
