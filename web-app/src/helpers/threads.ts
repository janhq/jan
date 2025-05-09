import { models, StreamCompletionResponse, TokenJS } from 'token.js'

/**
 * @fileoverview Helper functions for creating thread content.
 * These functions are used to create thread content objects
 * for different types of content, such as text and image.
 * The functions return objects that conform to the `ThreadContent` type.
 * @param content - The content of the thread
 * @returns
 */
export const newUserThreadContent = (content: string): ThreadContent => ({
  type: 'text',
  role: 'user',
  text: {
    value: content,
    annotations: [],
  },
})
/**
 * @fileoverview Helper functions for creating thread content.
 * These functions are used to create thread content objects
 * for different types of content, such as text and image.
 * The functions return objects that conform to the `ThreadContent` type.
 * @param content - The content of the thread
 * @returns
 */
export const newAssistantThreadContent = (content: string): ThreadContent => ({
  type: 'text',
  role: 'assistant',
  text: {
    value: content,
    annotations: [],
  },
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
