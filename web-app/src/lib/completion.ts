import {
  ContentType,
  ChatCompletionRole,
  ThreadMessage,
  MessageStatus,
  EngineManager,
  ModelManager,
} from '@janhq/core'
import { invoke } from '@tauri-apps/api/core'
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
 * Empty thread content object.
 * @returns
 */
export const emptyThreadContent: ThreadMessage = {
  type: 'text',
  role: ChatCompletionRole.Assistant,
  id: ulid(),
  object: 'thread.message',
  thread_id: '',
  content: [],
  status: MessageStatus.Ready,
  created_at: 0,
  completed_at: 0,
}

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
  if (!thread?.model?.id || !provider) return undefined

  let providerName = provider.provider as unknown as keyof typeof models

  if (!Object.keys(models).some((key) => key === providerName))
    providerName = 'openai-compatible'

  const tokenJS = new TokenJS({
    apiKey: provider.api_key ?? (await invoke('app_token')),
    // TODO: Retrieve from extension settings
    baseURL: provider.base_url ?? 'http://localhost:39291/v1',
  })

  // TODO: Add message history
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

export const startModel = async (
  provider: string,
  model: string
): Promise<void> => {
  // TODO: Remove hard coded provider name
  const providerObj = EngineManager.instance().get(
    provider === 'llama.cpp' ? 'llama-cpp' : provider
  )
  const modelObj = ModelManager.instance().get(model)
  if (providerObj && modelObj) return providerObj?.loadModel(modelObj)
}
export const stopModel = async (
  provider: string,
  model: string
): Promise<void> => {
  // TODO: Remove hard coded provider name
  const providerObj = EngineManager.instance().get(
    provider === 'llama.cpp' ? 'llama-cpp' : provider
  )
  const modelObj = ModelManager.instance().get(model)
  if (providerObj && modelObj) return providerObj?.unloadModel(modelObj)
}
