import '@janhq/cortex-node/shims/web'
import { useCallback } from 'react'

import { Assistant, Model, Thread, ThreadMessage } from '@janhq/core'
import { Cortex } from '@janhq/cortex-node'

import { ChatCompletionMessage } from '@janhq/cortex-node/dist/resources'
import { MessageCreateParams } from '@janhq/cortex-node/dist/resources/beta/threads/messages'
import { useAtomValue } from 'jotai'

import { hostAtom } from '@/helpers/atoms/AppConfig.atom'
import { ThreadAssistantInfo } from '@janhq/core/.'

const useCortex = () => {
  const host = useAtomValue(hostAtom)

  const cortex = new Cortex({
    baseURL: host,
    apiKey: '',
    dangerouslyAllowBrowser: true,
  })

  const fetchAssistants = useCallback(async () => {
    const assistants: Assistant[] = []
    const response = await cortex.beta.assistants.list()
    response.data.forEach((assistant) => {
      assistants.push(assistant)
    })
    return assistants
  }, [cortex.beta.assistants])

  const fetchThreads = useCallback(async () => {
    const threads: Thread[] = []
    for await (const thread of cortex.beta.threads.list()) {
      threads.push(thread)
    }
    return threads
  }, [cortex.beta.threads])

  const fetchModels = useCallback(async () => {
    const models: Model[] = []
    for await (const model of cortex.models.list()) {
      models.push(model)
    }
    return models
  }, [cortex.models])

  const fetchMessages = useCallback(
    async (threadId: string) => {
      const messages: ThreadMessage[] = []
      const response = await cortex.beta.threads.messages.list(threadId)
      response.data.forEach((message) => {
        messages.push(message)
      })
      return messages
    },
    [cortex.beta.threads.messages]
  )

  const startModel = useCallback(
    async (modelId: string, options?: Record<string, unknown>) => {
      await cortex.models.start(modelId, options ?? {})
    },
    [cortex.models]
  )

  const streamChatMessages = useCallback(
    async (modelId: string, messages: ChatCompletionMessage[]) => {
      const stream = await cortex.chat.completions.create({
        model: modelId,
        messages: messages,
        stream: true,
        max_tokens: 2048, // TODO: passing those options from outside
        stop: [],
        frequency_penalty: 0.7,
        presence_penalty: 0.7,
        temperature: 0.7,
        top_p: 1,
      })
      return stream
    },
    [cortex.chat.completions]
  )

  const deleteModel = useCallback(
    async (modelId: string) => {
      await cortex.models.del(modelId)
    },
    [cortex.models]
  )

  const cleanThread = useCallback(async (threadId: string) => {
    // TODO: OpenAI does not support this
    // remove all message except msg.role === ChatCompletionRole.System
  }, [])

  const deleteThread = useCallback(
    async (threadId: string) => {
      await cortex.beta.threads.del(threadId)
    },
    [cortex.beta.threads]
  )

  const updateThread = useCallback(
    async (thread: Thread) => {
      await cortex.beta.threads.update(thread.id, thread)
    },
    [cortex.beta.threads]
  )

  const deleteMessage = useCallback(
    async (threadId: string, messageId: string) =>
      cortex.beta.threads.messages.del(threadId, messageId),
    [cortex.beta.threads]
  )

  const createMessage = useCallback(
    async (threadId: string, createMessageParams: MessageCreateParams) => {
      return cortex.beta.threads.messages.create(threadId, createMessageParams)
    },
    [cortex.beta.threads]
  )

  const updateMessage = useCallback(
    async (threadId: string, messageId: string, data: object) => {
      return cortex.beta.threads.messages.update(threadId, messageId, data)
    },
    [cortex.beta.threads]
  )

  const createThread = useCallback(
    async (assistantInfo: ThreadAssistantInfo[]) => {
      return cortex.beta.threads.create({
        // @ts-expect-error testing
        assistants: assistantInfo,
      })
    },
    [cortex.beta.threads]
  )

  return {
    fetchAssistants,
    fetchThreads,
    fetchModels,
    fetchMessages,
    startModel,
    streamChatMessages,
    deleteModel,
    deleteThread,
    deleteMessage,
    cleanThread,
    updateThread,
    createMessage,
    updateMessage,
    createThread,
  }
}

export default useCortex
