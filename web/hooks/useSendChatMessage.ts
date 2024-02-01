/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef } from 'react'

import {
  ChatCompletionMessage,
  ChatCompletionRole,
  ContentType,
  MessageRequest,
  MessageStatus,
  ExtensionTypeEnum,
  Thread,
  ThreadMessage,
  events,
  Model,
  ConversationalExtension,
  MessageEvent,
  InferenceEngine,
  ChatCompletionMessageContentType,
  AssistantTool,
} from '@janhq/core'
import { atom, useAtom, useAtomValue, useSetAtom } from 'jotai'

import { ulid } from 'ulid'

import { selectedModelAtom } from '@/containers/DropdownListSidebar'
import { currentPromptAtom, fileUploadAtom } from '@/containers/Providers/Jotai'

import { toaster } from '@/containers/Toast'

import { getBase64 } from '@/utils/base64'
import { toRuntimeParams, toSettingParams } from '@/utils/modelParam'

import { useActiveModel } from './useActiveModel'

import { extensionManager } from '@/extension/ExtensionManager'
import {
  addNewMessageAtom,
  getCurrentChatMessagesAtom,
} from '@/helpers/atoms/ChatMessage.atom'
import {
  activeThreadAtom,
  engineParamsUpdateAtom,
  getActiveThreadModelParamsAtom,
  updateThreadAtom,
  updateThreadWaitingForResponseAtom,
} from '@/helpers/atoms/Thread.atom'

export const queuedMessageAtom = atom(false)
export const reloadModelAtom = atom(false)

export default function useSendChatMessage() {
  const activeThread = useAtomValue(activeThreadAtom)
  const addNewMessage = useSetAtom(addNewMessageAtom)
  const updateThread = useSetAtom(updateThreadAtom)
  const updateThreadWaiting = useSetAtom(updateThreadWaitingForResponseAtom)
  const setCurrentPrompt = useSetAtom(currentPromptAtom)

  const currentMessages = useAtomValue(getCurrentChatMessagesAtom)
  const { activeModel } = useActiveModel()
  const selectedModel = useAtomValue(selectedModelAtom)
  const { startModel } = useActiveModel()
  const setQueuedMessage = useSetAtom(queuedMessageAtom)

  const modelRef = useRef<Model | undefined>()
  const activeModelParams = useAtomValue(getActiveThreadModelParamsAtom)
  const engineParamsUpdate = useAtomValue(engineParamsUpdateAtom)

  const setEngineParamsUpdate = useSetAtom(engineParamsUpdateAtom)
  const setReloadModel = useSetAtom(reloadModelAtom)
  const [fileUpload, setFileUpload] = useAtom(fileUploadAtom)

  useEffect(() => {
    modelRef.current = activeModel
  }, [activeModel])

  const resendChatMessage = async (currentMessage: ThreadMessage) => {
    if (!activeThread) {
      console.error('No active thread')
      return
    }
    updateThreadWaiting(activeThread.id, true)
    const messages: ChatCompletionMessage[] = [
      activeThread.assistants[0]?.instructions,
    ]
      .filter((e) => e && e.trim() !== '')
      .map<ChatCompletionMessage>((instructions) => {
        const systemMessage: ChatCompletionMessage = {
          role: ChatCompletionRole.System,
          content: instructions,
        }
        return systemMessage
      })
      .concat(
        currentMessages
          .filter(
            (e) =>
              currentMessage.role === ChatCompletionRole.User ||
              e.id !== currentMessage.id
          )
          .map<ChatCompletionMessage>((msg) => ({
            role: msg.role,
            content: msg.content[0]?.text.value ?? '',
          }))
      )

    const messageRequest: MessageRequest = {
      id: ulid(),
      messages: messages,
      threadId: activeThread.id,
      model: activeThread.assistants[0].model ?? selectedModel,
    }

    const modelId = selectedModel?.id ?? activeThread.assistants[0].model.id

    if (activeModel?.id !== modelId) {
      setQueuedMessage(true)
      startModel(modelId)
      await waitForModelStarting(modelId)
      setQueuedMessage(false)
    }
    events.emit(MessageEvent.OnMessageSent, messageRequest)
  }

  // TODO: Refactor @louis
  const waitForModelStarting = async (modelId: string) => {
    return new Promise<void>((resolve) => {
      setTimeout(async () => {
        if (modelRef.current?.id !== modelId) {
          console.debug('waiting for model to start')
          await waitForModelStarting(modelId)
          resolve()
        } else {
          resolve()
        }
      }, 200)
    })
  }

  const sendChatMessage = async (message: string) => {
    if (!message || message.trim().length === 0) return

    if (!activeThread) {
      console.error('No active thread')
      return
    }

    if (engineParamsUpdate) setReloadModel(true)

    const runtimeParams = toRuntimeParams(activeModelParams)
    const settingParams = toSettingParams(activeModelParams)

    updateThreadWaiting(activeThread.id, true)
    const prompt = message.trim()
    setCurrentPrompt('')

    const base64Blob = fileUpload[0]
      ? await getBase64(fileUpload[0].file).then()
      : undefined

    const msgId = ulid()

    const messages: ChatCompletionMessage[] = [
      activeThread.assistants[0]?.instructions,
    ]
      .filter((e) => e && e.trim() !== '')
      .map<ChatCompletionMessage>((instructions) => {
        const systemMessage: ChatCompletionMessage = {
          role: ChatCompletionRole.System,
          content: instructions,
        }
        return systemMessage
      })
      .concat(
        currentMessages
          .map<ChatCompletionMessage>((msg) => ({
            role: msg.role,
            content: msg.content[0]?.text.value ?? '',
          }))
          .concat([
            {
              role: ChatCompletionRole.User,
              content:
                selectedModel && base64Blob
                  ? [
                      {
                        type: ChatCompletionMessageContentType.Text,
                        text: prompt,
                      },
                      {
                        type: ChatCompletionMessageContentType.Doc,
                        doc_url: {
                          url: `threads/${activeThread.id}/files/${msgId}.pdf`,
                        },
                      },
                    ]
                  : prompt,
            } as ChatCompletionMessage,
          ])
      )

    let modelRequest = selectedModel ?? activeThread.assistants[0].model
    if (runtimeParams.stream == null) {
      runtimeParams.stream = true
    }
    // Add middleware to the model request with tool retrieval enabled
    if (
      activeThread.assistants[0].tools?.some(
        (tool: AssistantTool) => tool.type === 'retrieval' && tool.enabled
      )
    ) {
      modelRequest = {
        ...modelRequest,
        engine: InferenceEngine.tool_retrieval_enabled,
        proxyEngine: modelRequest.engine,
      }
    }
    const messageRequest: MessageRequest = {
      id: msgId,
      threadId: activeThread.id,
      messages,
      model: {
        ...modelRequest,
        settings: settingParams,
        parameters: runtimeParams,
      },
      thread: activeThread,
    }
    const timestamp = Date.now()

    const content: any = []

    if (base64Blob && fileUpload[0]?.type === 'image') {
      content.push({
        type: ContentType.Image,
        text: {
          value: prompt,
          annotations: [base64Blob],
        },
      })
    }

    if (base64Blob && fileUpload[0]?.type === 'pdf') {
      content.push({
        type: ContentType.Pdf,
        text: {
          value: prompt,
          annotations: [base64Blob],
          name: fileUpload[0].file.name,
          size: fileUpload[0].file.size,
        },
      })
    }

    if (prompt && !base64Blob) {
      content.push({
        type: ContentType.Text,
        text: {
          value: prompt,
          annotations: [],
        },
      })
    }

    const threadMessage: ThreadMessage = {
      id: msgId,
      thread_id: activeThread.id,
      role: ChatCompletionRole.User,
      status: MessageStatus.Ready,
      created: timestamp,
      updated: timestamp,
      object: 'thread.message',
      content: content,
    }

    addNewMessage(threadMessage)
    if (base64Blob) {
      setFileUpload([])
    }

    const updatedThread: Thread = {
      ...activeThread,
      updated: timestamp,
    }

    // change last update thread when send message
    updateThread(updatedThread)

    await extensionManager
      .get<ConversationalExtension>(ExtensionTypeEnum.Conversational)
      ?.addNewMessage(threadMessage)

    const modelId = selectedModel?.id ?? activeThread.assistants[0].model.id

    if (activeModel?.id !== modelId) {
      setQueuedMessage(true)
      startModel(modelId)
      await waitForModelStarting(modelId)
      setQueuedMessage(false)
    }

    events.emit(MessageEvent.OnMessageSent, messageRequest)

    setReloadModel(false)
    setEngineParamsUpdate(false)
  }

  return {
    sendChatMessage,
    resendChatMessage,
  }
}
