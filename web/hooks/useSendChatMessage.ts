import { useEffect, useRef } from 'react'

import {
  MessageRequestType,
  ExtensionTypeEnum,
  Thread,
  ThreadMessage,
  Model,
  ConversationalExtension,
  ThreadAssistantInfo,
  events,
  MessageEvent,
  ContentType,
  EngineManager,
  InferenceEngine,
  MessageStatus,
  ChatCompletionRole,
} from '@janhq/core'
import { extractInferenceParams, extractModelLoadParams } from '@janhq/core'
import { atom, useAtom, useAtomValue, useSetAtom } from 'jotai'
import { OpenAI } from 'openai'

import {
  ChatCompletionMessageParam,
  ChatCompletionRole as OpenAIChatCompletionRole,
  ChatCompletionTool,
  ChatCompletionMessageToolCall,
} from 'openai/resources/chat'

import { Stream } from 'openai/streaming'
import { ulid } from 'ulidx'

import { modelDropdownStateAtom } from '@/containers/ModelDropdown'
import {
  currentPromptAtom,
  editPromptAtom,
  fileUploadAtom,
} from '@/containers/Providers/Jotai'

import { compressImage, getBase64 } from '@/utils/base64'
import { MessageRequestBuilder } from '@/utils/messageRequestBuilder'

import { ThreadMessageBuilder } from '@/utils/threadMessageBuilder'

import { useActiveModel } from './useActiveModel'

import { extensionManager } from '@/extension/ExtensionManager'
import { activeAssistantAtom } from '@/helpers/atoms/Assistant.atom'
import {
  addNewMessageAtom,
  deleteMessageAtom,
  getCurrentChatMessagesAtom,
  tokenSpeedAtom,
} from '@/helpers/atoms/ChatMessage.atom'
import { selectedModelAtom } from '@/helpers/atoms/Model.atom'
import {
  activeThreadAtom,
  approvedThreadToolsAtom,
  disabledThreadToolsAtom,
  engineParamsUpdateAtom,
  getActiveThreadModelParamsAtom,
  isGeneratingResponseAtom,
  updateThreadAtom,
  updateThreadWaitingForResponseAtom,
} from '@/helpers/atoms/Thread.atom'
import { ModelTool } from '@/types/model'

export const reloadModelAtom = atom(false)

export default function useSendChatMessage(
  showModal?: (toolName: string, threadId: string) => Promise<unknown>
) {
  const activeThread = useAtomValue(activeThreadAtom)
  const activeAssistant = useAtomValue(activeAssistantAtom)
  const addNewMessage = useSetAtom(addNewMessageAtom)
  const updateThread = useSetAtom(updateThreadAtom)
  const updateThreadWaiting = useSetAtom(updateThreadWaitingForResponseAtom)
  const setCurrentPrompt = useSetAtom(currentPromptAtom)
  const deleteMessage = useSetAtom(deleteMessageAtom)
  const setEditPrompt = useSetAtom(editPromptAtom)
  const approvedTools = useAtomValue(approvedThreadToolsAtom)
  const disabledTools = useAtomValue(disabledThreadToolsAtom)

  const currentMessages = useAtomValue(getCurrentChatMessagesAtom)
  const selectedModel = useAtomValue(selectedModelAtom)
  const { activeModel, startModel } = useActiveModel()

  const modelRef = useRef<Model | undefined>()
  const activeModelParams = useAtomValue(getActiveThreadModelParamsAtom)
  const engineParamsUpdate = useAtomValue(engineParamsUpdateAtom)

  const setEngineParamsUpdate = useSetAtom(engineParamsUpdateAtom)
  const setReloadModel = useSetAtom(reloadModelAtom)
  const [fileUpload, setFileUpload] = useAtom(fileUploadAtom)
  const setIsGeneratingResponse = useSetAtom(isGeneratingResponseAtom)
  const activeThreadRef = useRef<Thread | undefined>()
  const activeAssistantRef = useRef<ThreadAssistantInfo | undefined>()
  const setTokenSpeed = useSetAtom(tokenSpeedAtom)
  const setModelDropdownState = useSetAtom(modelDropdownStateAtom)

  const selectedModelRef = useRef<Model | undefined>()

  useEffect(() => {
    modelRef.current = activeModel
  }, [activeModel])

  useEffect(() => {
    activeThreadRef.current = activeThread
  }, [activeThread])

  useEffect(() => {
    selectedModelRef.current = selectedModel
  }, [selectedModel])

  useEffect(() => {
    activeAssistantRef.current = activeAssistant
  }, [activeAssistant])

  const resendChatMessage = async () => {
    // Delete last response before regenerating
    const newConvoData = Array.from(currentMessages)
    let toSendMessage = newConvoData.pop()

    while (toSendMessage && toSendMessage?.role !== 'user') {
      await extensionManager
        .get<ConversationalExtension>(ExtensionTypeEnum.Conversational)
        ?.deleteMessage(toSendMessage.thread_id, toSendMessage.id)
        .catch(console.error)
      deleteMessage(toSendMessage.id ?? '')
      toSendMessage = newConvoData.pop()
    }

    if (toSendMessage?.content[0]?.text?.value)
      sendChatMessage(toSendMessage.content[0].text.value, true, newConvoData)
  }

  const sendChatMessage = async (
    message: string,
    isResend: boolean = false,
    messages?: ThreadMessage[]
  ) => {
    if (!message || message.trim().length === 0) return

    const activeThread = activeThreadRef.current
    const activeAssistant = activeAssistantRef.current
    const activeModel = selectedModelRef.current

    if (!activeThread || !activeAssistant) {
      console.error('No active thread or assistant')
      return
    }

    if (!activeModel?.id) {
      setModelDropdownState(true)
      return
    }

    if (engineParamsUpdate) setReloadModel(true)
    setTokenSpeed(undefined)

    const runtimeParams = extractInferenceParams(activeModelParams)
    const settingParams = extractModelLoadParams(activeModelParams)

    const prompt = message.trim()

    updateThreadWaiting(activeThread.id, true)
    setCurrentPrompt('')
    setEditPrompt('')

    let base64Blob = fileUpload ? await getBase64(fileUpload.file) : undefined

    if (base64Blob && fileUpload?.type === 'image') {
      // Compress image
      base64Blob = await compressImage(base64Blob, 512)
    }

    const modelRequest = selectedModel ?? activeAssistant.model

    // Fallback support for previous broken threads
    if (activeAssistant.model?.id === '*') {
      activeAssistant.model = {
        id: activeModel.id,
        settings: activeModel.settings,
        parameters: activeModel.parameters,
      }
    }
    if (runtimeParams.stream == null) {
      runtimeParams.stream = true
    }

    // Build Message Request
    const requestBuilder = new MessageRequestBuilder(
      MessageRequestType.Thread,
      {
        ...modelRequest,
        settings: settingParams,
        parameters: runtimeParams,
      },
      activeThread,
      messages ?? currentMessages,
      (await window.core.api.getTools())
        ?.filter((tool: ModelTool) => !disabledTools.includes(tool.name))
        .map((tool: ModelTool) => ({
          type: 'function' as const,
          function: {
            name: tool.name,
            description: tool.description?.slice(0, 1024),
            parameters: tool.inputSchema,
            strict: false,
          },
        }))
    ).addSystemMessage(activeAssistant.instructions)

    requestBuilder.pushMessage(prompt, base64Blob, fileUpload)

    // Build Thread Message to persist
    const threadMessageBuilder = new ThreadMessageBuilder(
      requestBuilder
    ).pushMessage(prompt, base64Blob, fileUpload)

    const newMessage = threadMessageBuilder.build()

    // Update thread state
    const updatedThread: Thread = {
      ...activeThread,
      updated: newMessage.created_at,
      metadata: {
        ...activeThread.metadata,
        lastMessage: prompt,
      },
    }
    updateThread(updatedThread)

    if (
      !isResend &&
      (newMessage.content.length || newMessage.attachments?.length)
    ) {
      // Add message
      const createdMessage = await extensionManager
        .get<ConversationalExtension>(ExtensionTypeEnum.Conversational)
        ?.createMessage(newMessage)
        .catch(() => undefined)

      if (!createdMessage) return

      // Push to states
      addNewMessage(createdMessage)
    }

    // Start Model if not started
    const modelId = selectedModel?.id ?? activeAssistantRef.current?.model.id

    if (base64Blob) {
      setFileUpload(undefined)
    }

    if (activeModel?.id !== modelId && modelId) {
      const error = await startModel(modelId).catch((error: Error) => error)
      if (error) {
        updateThreadWaiting(activeThread.id, false)
        return
      }
    }
    setIsGeneratingResponse(true)

    if (requestBuilder.tools && requestBuilder.tools.length) {
      let isDone = false
      const openai = new OpenAI({
        apiKey: await window.core.api.appToken(),
        baseURL: `${API_BASE_URL}/v1`,
        dangerouslyAllowBrowser: true,
      })
      let parentMessageId: string | undefined
      while (!isDone) {
        let messageId = ulid()
        if (!parentMessageId) {
          parentMessageId = ulid()
          messageId = parentMessageId
        }
        const data = requestBuilder.build()
        const message: ThreadMessage = {
          id: messageId,
          object: 'message',
          thread_id: activeThread.id,
          assistant_id: activeAssistant.assistant_id,
          role: ChatCompletionRole.Assistant,
          content: [],
          metadata: {
            ...(messageId !== parentMessageId
              ? { parent_id: parentMessageId }
              : {}),
          },
          status: MessageStatus.Pending,
          created_at: Date.now() / 1000,
          completed_at: Date.now() / 1000,
        }
        events.emit(MessageEvent.OnMessageResponse, message)
        const response = await openai.chat.completions.create({
          messages: requestBuilder.messages as ChatCompletionMessageParam[],
          model: data.model?.id ?? '',
          tools: data.tools as ChatCompletionTool[],
          stream: data.model?.parameters?.stream ?? false,
          tool_choice: 'auto',
        })
        // Variables to track and accumulate streaming content
        if (!message.content.length) {
          message.content = [
            {
              type: ContentType.Text,
              text: {
                value: '',
                annotations: [],
              },
            },
          ]
        }
        if (data.model?.parameters?.stream)
          isDone = await processStreamingResponse(
            response as Stream<OpenAI.Chat.Completions.ChatCompletionChunk>,
            requestBuilder,
            message
          )
        else {
          isDone = await processNonStreamingResponse(
            response as OpenAI.Chat.Completions.ChatCompletion,
            requestBuilder,
            message
          )
        }
        message.status = MessageStatus.Ready
        events.emit(MessageEvent.OnMessageUpdate, message)
      }
    } else {
      // Request for inference
      EngineManager.instance()
        .get(InferenceEngine.cortex)
        ?.inference(requestBuilder.build())
    }

    // Reset states
    setReloadModel(false)
    setEngineParamsUpdate(false)
  }

  const processNonStreamingResponse = async (
    response: OpenAI.Chat.Completions.ChatCompletion,
    requestBuilder: MessageRequestBuilder,
    message: ThreadMessage
  ): Promise<boolean> => {
    // Handle tool calls in the response
    const toolCalls: ChatCompletionMessageToolCall[] =
      response.choices[0]?.message?.tool_calls ?? []
    const content = response.choices[0].message?.content
    message.content = [
      {
        type: ContentType.Text,
        text: {
          value: content ?? '',
          annotations: [],
        },
      },
    ]
    events.emit(MessageEvent.OnMessageUpdate, message)
    await postMessageProcessing(
      toolCalls ?? [],
      requestBuilder,
      message,
      content ?? ''
    )
    return !toolCalls || !toolCalls.length
  }

  const processStreamingResponse = async (
    response: Stream<OpenAI.Chat.Completions.ChatCompletionChunk>,
    requestBuilder: MessageRequestBuilder,
    message: ThreadMessage
  ): Promise<boolean> => {
    // Variables to track and accumulate streaming content
    let currentToolCall: {
      id: string
      function: { name: string; arguments: string }
    } | null = null
    let accumulatedContent = ''
    const toolCalls: ChatCompletionMessageToolCall[] = []
    // Process the streaming chunks
    for await (const chunk of response) {
      // Handle tool calls in the chunk
      if (chunk.choices[0]?.delta?.tool_calls) {
        const deltaToolCalls = chunk.choices[0].delta.tool_calls

        // Handle the beginning of a new tool call
        if (
          deltaToolCalls[0]?.index !== undefined &&
          deltaToolCalls[0]?.function
        ) {
          const index = deltaToolCalls[0].index

          // Create new tool call if this is the first chunk for it
          if (!toolCalls[index]) {
            toolCalls[index] = {
              id: deltaToolCalls[0]?.id || '',
              function: {
                name: deltaToolCalls[0]?.function?.name || '',
                arguments: deltaToolCalls[0]?.function?.arguments || '',
              },
              type: 'function',
            }
            currentToolCall = toolCalls[index]
          } else {
            // Continuation of existing tool call
            currentToolCall = toolCalls[index]

            // Append to function name or arguments if they exist in this chunk
            if (deltaToolCalls[0]?.function?.name) {
              currentToolCall!.function.name += deltaToolCalls[0].function.name
            }

            if (deltaToolCalls[0]?.function?.arguments) {
              currentToolCall!.function.arguments +=
                deltaToolCalls[0].function.arguments
            }
          }
        }
      }

      // Handle regular content in the chunk
      if (chunk.choices[0]?.delta?.content) {
        const content = chunk.choices[0].delta.content
        accumulatedContent += content

        message.content = [
          {
            type: ContentType.Text,
            text: {
              value: accumulatedContent,
              annotations: [],
            },
          },
        ]
        events.emit(MessageEvent.OnMessageUpdate, message)
      }
    }

    await postMessageProcessing(
      toolCalls ?? [],
      requestBuilder,
      message,
      accumulatedContent ?? ''
    )
    return !toolCalls || !toolCalls.length
  }

  const postMessageProcessing = async (
    toolCalls: ChatCompletionMessageToolCall[],
    requestBuilder: MessageRequestBuilder,
    message: ThreadMessage,
    content: string
  ) => {
    requestBuilder.pushAssistantMessage({
      content,
      role: 'assistant',
      refusal: null,
      tool_calls: toolCalls,
    })

    // Handle completed tool calls
    if (toolCalls.length > 0) {
      for (const toolCall of toolCalls) {
        const toolId = ulid()
        const toolCallsMetadata =
          message.metadata?.tool_calls &&
          Array.isArray(message.metadata?.tool_calls)
            ? message.metadata?.tool_calls
            : []
        message.metadata = {
          ...(message.metadata ?? {}),
          tool_calls: [
            ...toolCallsMetadata,
            {
              tool: {
                ...toolCall,
                id: toolId,
              },
              response: undefined,
              state: 'pending',
            },
          ],
        }
        events.emit(MessageEvent.OnMessageUpdate, message)

        const approved =
          approvedTools[message.thread_id]?.includes(toolCall.function.name) ||
          (showModal
            ? await showModal(toolCall.function.name, message.thread_id)
            : true)

        const result = approved
          ? await window.core.api.callTool({
              toolName: toolCall.function.name,
              arguments: JSON.parse(toolCall.function.arguments),
            })
          : {
              content: [
                {
                  type: 'text',
                  text: 'The user has chosen to disallow the tool call.',
                },
              ],
            }
        if (result.error) break

        message.metadata = {
          ...(message.metadata ?? {}),
          tool_calls: [
            ...toolCallsMetadata,
            {
              tool: {
                ...toolCall,
                id: toolId,
              },
              response: result,
              state: 'ready',
            },
          ],
        }

        requestBuilder.pushToolMessage(
          result.content[0]?.text ?? '',
          toolCall.id
        )
        events.emit(MessageEvent.OnMessageUpdate, message)
      }
    }
  }

  return {
    sendChatMessage,
    resendChatMessage,
  }
}
