import {
  ContentType,
  ChatCompletionRole,
  ThreadMessage,
  MessageStatus,
} from '@janhq/core'
import { models, StreamCompletionResponse, TokenJS } from 'token.js'
import { ulid } from 'ulidx'
/**
 * @fileoverview Helper functions for creating thread content.
 * These functions are used to create thread content objects
 * for different types of content, such as text and image.
 * The functions return objects that conform to the `ThreadContent` type.
 * @param content - The content of the thread
 * @returns
 */
export const newUserThreadContent = (
  threadId: string,
  content: string
): ThreadMessage => ({
  type: 'text',
  role: ChatCompletionRole.User,
  content: [
    {
      type: ContentType.Text,
      text: {
        value: content,
        annotations: [],
      },
    },
  ],
  id: ulid(),
  object: 'thread.message',
  thread_id: threadId,
  status: MessageStatus.Ready,
  created_at: 0,
  completed_at: 0,
})
/**
 * @fileoverview Helper functions for creating thread content.
 * These functions are used to create thread content objects
 * for different types of content, such as text and image.
 * The functions return objects that conform to the `ThreadContent` type.
 * @param content - The content of the thread
 * @returns
 */
export const newAssistantThreadContent = (
  threadId: string,
  content: string
): ThreadMessage => ({
  type: 'text',
  role: ChatCompletionRole.Assistant,
  content: [
    {
      type: ContentType.Text,
      text: {
        value: content,
        annotations: [],
      },
    },
  ],
  id: ulid(),
  object: 'thread.message',
  thread_id: threadId,
  status: MessageStatus.Ready,
  created_at: 0,
  completed_at: 0,
})

/**
 * @fileoverview Helper function to send a completion request to the model provider.
 * @param thread
 * @param provider
 * @param prompt
 * @returns
 */
export const sendCompletion = async (
  thread: Thread,
  provider: ModelProvider,
  prompt: string
): Promise<StreamCompletionResponse | undefined> => {
  if (!thread?.model?.id || !provider || !provider.api_key) return undefined

  let providerName = provider.provider as unknown as keyof typeof models

  if (!Object.keys(models).some((key) => key === providerName))
    providerName = 'openai-compatible'

  const tokenJS = new TokenJS({
    apiKey: provider.api_key,
    baseURL: provider.base_url,
  })

  const completion = await tokenJS.chat.completions.create({
    stream: true,
    provider: providerName,
    model: thread.model?.id,
    messages: [
      {
        role: 'user',
        content: prompt,
      },
    ],
  })
  return completion
}
