import 'cortexso-node/shims/web'
import { useCallback } from 'react'

import {
  Assistant,
  Model,
  Message,
  Thread,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionCreateParamsStreaming,
  AssistantCreateParams,
  AssistantUpdateParams,
  LlmEngine,
} from '@janhq/core'

import { Cortex } from 'cortexso-node'

import { useAtomValue } from 'jotai'

import { UpdateConfigMutationVariables } from './useEngineMutation'
import { MessageCreateMutationVariables } from './useMessageCreateMutation'
import { MessageDeleteMutationVariables } from './useMessageDeleteMutation'
import { MessageUpdateMutationVariables } from './useMessageUpdateMutation'

import { hostAtom } from '@/helpers/atoms/AppConfig.atom'

const EngineInitStatuses = [
  'ready',
  'not_initialized',
  'missing_configuration',
] as const
export type EngineInitStatus = (typeof EngineInitStatuses)[number]

export type EngineStatus = {
  name: LlmEngine
  description: string
  version: string
  productName: string
  status: EngineInitStatus
}

const useCortex = () => {
  const host = useAtomValue(hostAtom)

  const cortex = new Cortex({
    baseURL: host,
    apiKey: '',
    dangerouslyAllowBrowser: true,
  })

  // TODO: put in to cortexso-node?
  const getEngineStatuses = useCallback(async (): Promise<EngineStatus[]> => {
    const response = await fetch(`${host}/engines`, {
      method: 'GET',
    })
    const data = await response.json()
    const engineStatuses: EngineStatus[] = []
    data.data.forEach((engineStatus: EngineStatus) => {
      engineStatuses.push(engineStatus)
    })
    return engineStatuses
  }, [host])

  // TODO: put in to cortexso-node?
  const getEngineStatus = useCallback(
    async (engine: LlmEngine): Promise<EngineStatus | undefined> => {
      try {
        const response = await fetch(`${host}/engines/${engine}`, {
          method: 'GET',
        })
        const data = (await response.json()) as EngineStatus
        return data
      } catch (err) {
        console.error(err)
      }
    },
    [host]
  )

  // TODO: put in to cortexso-node?
  const initializeEngine = useCallback(
    async (engine: LlmEngine) => {
      try {
        await fetch(`${host}/engines/${engine}/init/`, {
          method: 'POST',
          headers: {
            accept: 'application/json',
          },
        })
      } catch (err) {
        console.error(err)
      }
    },
    [host]
  )

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
      // @ts-expect-error each thread must have associated assistants
      const assistants = thread['assistants'] as Assistant[]
      if (!assistants || assistants.length === 0) continue

      // @ts-expect-error each thread must have a title, else default to 'New Thread'
      const title: string = thread['title'] ?? 'New Thread'

      threads.push({
        ...thread,
        title: title,
        assistants: assistants,
      })
    }
    return threads
  }, [cortex.beta.threads])

  const fetchModels = useCallback(async () => {
    const models: Model[] = []
    for await (const model of cortex.models.list()) {
      // @ts-expect-error model should not be empty
      const modelId = model.model
      if (!modelId || modelId.length === 0) {
        console.debug('Model id is empty, skipping', model)
        continue
      }
      models.push({
        ...model,
        model: modelId,
        // @ts-expect-error each model must have associated files
        files: model['files'],
      })
    }
    return models
  }, [cortex.models])

  const fetchMessages = useCallback(
    async (threadId: string) => {
      try {
        const messages: Message[] = []
        const response = await cortex.beta.threads.messages.list(threadId)
        response.data.forEach((message) => {
          messages.push(message)
        })
        return messages
      } catch (error) {
        return []
      }
    },
    [cortex.beta.threads.messages]
  )

  const startModel = useCallback(
    async (modelId: string, options?: Record<string, unknown>) => {
      await cortex.models.start(modelId, options ?? {})
    },
    [cortex.models]
  )

  const stopModel = useCallback(
    async (modelId: string, options?: Record<string, unknown>) => {
      await cortex.models.stop(modelId, options ?? {})
    },
    [cortex.models]
  )

  const chatCompletionNonStreaming = useCallback(
    async (
      chatCompletionCreateParams: ChatCompletionCreateParamsNonStreaming,
      options?: Record<string, unknown>
      // @ts-expect-error incompatible types
    ) => cortex.chat.completions.create(chatCompletionCreateParams, options),
    [cortex.chat.completions]
  )

  const chatCompletionStreaming = useCallback(
    async (
      chatCompletionCreateParams: ChatCompletionCreateParamsStreaming,
      options?: Record<string, unknown>
      // @ts-expect-error incompatible types
    ) => cortex.chat.completions.create(chatCompletionCreateParams, options),
    [cortex.chat.completions]
  )

  const deleteModel = useCallback(
    async (modelId: string) => {
      await cortex.models.del(modelId)
    },
    [cortex.models]
  )

  const cleanThread = useCallback(
    async (threadId: string) => cortex.beta.threads.clean(threadId),
    [cortex.beta.threads]
  )

  const deleteThread = useCallback(
    async (threadId: string) => {
      await cortex.beta.threads.del(threadId)
    },
    [cortex.beta.threads]
  )

  const updateThread = useCallback(
    async (thread: Thread) => {
      const result = await cortex.beta.threads.update(thread.id, thread)
      console.debug(
        `Update thread ${thread.id}, result: ${JSON.stringify(result, null, 2)}`
      )
    },
    [cortex.beta.threads]
  )

  const deleteMessage = useCallback(
    async (params: MessageDeleteMutationVariables) => {
      const { threadId, messageId } = params
      return cortex.beta.threads.messages.del(threadId, messageId)
    },
    [cortex.beta.threads]
  )

  const createMessage = useCallback(
    async (params: MessageCreateMutationVariables) => {
      const { threadId, createMessageParams } = params
      return cortex.beta.threads.messages.create(threadId, createMessageParams)
    },
    [cortex.beta.threads]
  )

  const updateMessage = useCallback(
    async (params: MessageUpdateMutationVariables) => {
      const { threadId, messageId, data } = params
      return cortex.beta.threads.messages.update(threadId, messageId, data)
    },
    [cortex.beta.threads]
  )

  const createThread = useCallback(
    async (assistant: Assistant) => {
      const createThreadResponse = await cortex.beta.threads.create({
        // @ts-expect-error customize so that each thread will have an assistant
        assistants: [assistant],
      })
      const thread: Thread = {
        ...createThreadResponse,
        // @ts-expect-error each thread will have a title, else default to 'New Thread'
        title: createThreadResponse.title ?? 'New Thread',
        assistants: [assistant],
      }
      return thread
    },
    [cortex.beta.threads]
  )

  const updateModel = useCallback(
    async (modelId: string, options: Record<string, unknown>) =>
      cortex.models.update(modelId, options),
    [cortex.models]
  )

  const downloadModel = useCallback(
    async (modelId: string, fileName?: string, persistedModelId?: string) => {
      // TODO: clean this up in cortex-node. not sure why
      /**
       * query: {
            fileName: fileName,
          }, not work
       */
      if (!fileName) return cortex.models.download(modelId)
      return cortex.models.download(
        `${modelId}?fileName=${fileName}&persistedModelId=${persistedModelId}`
      )
    },
    [cortex.models]
  )

  const abortDownload = useCallback(
    async (downloadId: string) => cortex.models.abortDownload(downloadId),
    [cortex.models]
  )

  const createAssistant = useCallback(
    async (createParams: AssistantCreateParams) =>
      cortex.beta.assistants.create(createParams),
    [cortex.beta.assistants]
  )

  const updateAssistant = useCallback(
    async (assistantId: string, updateParams: AssistantUpdateParams) =>
      cortex.beta.assistants.update(assistantId, updateParams),
    [cortex.beta.assistants]
  )

  // TODO: add this to cortex-node
  const registerEngineConfig = useCallback(
    async (variables: UpdateConfigMutationVariables) => {
      try {
        const { engine, config } = variables
        await fetch(`${host}/engines/${engine}`, {
          method: 'PATCH',
          headers: {
            'accept': 'application/json',
            // eslint-disable-next-line @typescript-eslint/naming-convention
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(config),
        })
      } catch (err) {
        console.error(err)
      }
    },
    [host]
  )

  // add this to cortex-node?
  const createModel = useCallback(
    (model: Model) =>
      fetch(`${host}/models`, {
        method: 'POST',
        headers: {
          'accept': 'application/json',
          // eslint-disable-next-line @typescript-eslint/naming-convention
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(model),
      }),
    [host]
  )

  return {
    fetchAssistants,
    fetchThreads,
    fetchModels,
    fetchMessages,
    startModel,
    stopModel,
    chatCompletionStreaming,
    deleteModel,
    deleteThread,
    deleteMessage,
    cleanThread,
    updateThread,
    createMessage,
    updateMessage,
    createThread,
    downloadModel,
    abortDownload,
    createAssistant,
    updateAssistant,
    updateModel,
    chatCompletionNonStreaming,
    registerEngineConfig,
    createModel,
    getEngineStatus,
    initializeEngine,
    getEngineStatuses,
  }
}

export default useCortex
