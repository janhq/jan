/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef } from 'react'

import {
  ChatCompletionMessage,
  ChatCompletionRole,
  ContentType,
  MessageRequest,
  MessageRequestType,
  MessageStatus,
  ExtensionTypeEnum,
  Thread,
  ThreadMessage,
  Model,
  ConversationalExtension,
  InferenceEngine,
  ChatCompletionMessageContentType,
  AssistantTool,
  EngineManager,
} from '@janhq/core'
import { atom, useAtom, useAtomValue, useSetAtom } from 'jotai'

import { ulid } from 'ulidx'

import { selectedModelAtom } from '@/containers/DropdownListSidebar'
import {
  currentPromptAtom,
  editPromptAtom,
  fileUploadAtom,
} from '@/containers/Providers/Jotai'

import { compressImage, getBase64 } from '@/utils/base64'
import { toRuntimeParams, toSettingParams } from '@/utils/modelParam'

import { loadModelErrorAtom, useActiveModel } from './useActiveModel'

import { extensionManager } from '@/extension/ExtensionManager'
import {
  addNewMessageAtom,
  deleteMessageAtom,
  getCurrentChatMessagesAtom,
} from '@/helpers/atoms/ChatMessage.atom'
import {
  activeThreadAtom,
  engineParamsUpdateAtom,
  getActiveThreadModelParamsAtom,
  isGeneratingResponseAtom,
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
  const deleteMessage = useSetAtom(deleteMessageAtom)
  const setEditPrompt = useSetAtom(editPromptAtom)

  const currentMessages = useAtomValue(getCurrentChatMessagesAtom)
  const selectedModel = useAtomValue(selectedModelAtom)
  const { activeModel, startModel } = useActiveModel()
  const loadModelFailed = useAtomValue(loadModelErrorAtom)

  const modelRef = useRef<Model | undefined>()
  const loadModelFailedRef = useRef<string | undefined>()
  const activeModelParams = useAtomValue(getActiveThreadModelParamsAtom)
  const engineParamsUpdate = useAtomValue(engineParamsUpdateAtom)

  const setEngineParamsUpdate = useSetAtom(engineParamsUpdateAtom)
  const setReloadModel = useSetAtom(reloadModelAtom)
  const [fileUpload, setFileUpload] = useAtom(fileUploadAtom)
  const setIsGeneratingResponse = useSetAtom(isGeneratingResponseAtom)
  const activeThreadRef = useRef<Thread | undefined>()
  const setQueuedMessage = useSetAtom(queuedMessageAtom)

  const selectedModelRef = useRef<Model | undefined>()

  useEffect(() => {
    modelRef.current = activeModel
  }, [activeModel])

  useEffect(() => {
    loadModelFailedRef.current = loadModelFailed
  }, [loadModelFailed])

  useEffect(() => {
    activeThreadRef.current = activeThread
  }, [activeThread])

  useEffect(() => {
    selectedModelRef.current = selectedModel
  }, [selectedModel])

  const resendChatMessage = async (currentMessage: ThreadMessage) => {
    if (!activeThreadRef.current) {
      console.error('No active thread')
      return
    }
    updateThreadWaiting(activeThreadRef.current.id, true)
    const messages: ChatCompletionMessage[] = [
      activeThreadRef.current.assistants[0]?.instructions,
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
              (currentMessage.role === ChatCompletionRole.User ||
                e.id !== currentMessage.id) &&
              e.status !== MessageStatus.Error
          )
          .map<ChatCompletionMessage>((msg) => ({
            role: msg.role,
            content: msg.content[0]?.text.value ?? '',
          }))
      )

    const messageRequest: MessageRequest = {
      id: ulid(),
      type: MessageRequestType.Thread,
      messages: messages,
      threadId: activeThreadRef.current.id,
      model:
        activeThreadRef.current.assistants[0].model ?? selectedModelRef.current,
    }

    const modelId =
      selectedModelRef.current?.id ??
      activeThreadRef.current.assistants[0].model.id

    if (modelRef.current?.id !== modelId) {
      await startModel(modelId)
    }
    setIsGeneratingResponse(true)
    if (currentMessage.role !== ChatCompletionRole.User) {
      // Delete last response before regenerating
      deleteMessage(currentMessage.id ?? '')
      if (activeThreadRef.current) {
        await extensionManager
          .get<ConversationalExtension>(ExtensionTypeEnum.Conversational)
          ?.writeMessages(
            activeThreadRef.current.id,
            currentMessages.filter((msg) => msg.id !== currentMessage.id)
          )
      }
    }
    const engine = EngineManager.instance()?.get(
      messageRequest.model?.engine ?? selectedModelRef.current?.engine ?? ''
    )
    engine?.inference(messageRequest)
  }

  const sendChatMessage = async (message: string) => {
    if (!message || message.trim().length === 0) return

    if (!activeThreadRef.current) {
      console.error('No active thread')
      return
    }

    if (engineParamsUpdate) setReloadModel(true)

    const runtimeParams = toRuntimeParams(activeModelParams)
    const settingParams = toSettingParams(activeModelParams)

    updateThreadWaiting(activeThreadRef.current.id, true)
    const prompt = message.trim()
    setCurrentPrompt('')
    setEditPrompt('')

    let base64Blob = fileUpload[0]
      ? await getBase64(fileUpload[0].file)
      : undefined

    const fileContentType = fileUpload[0]?.type

    const msgId = ulid()

    const isDocumentInput = base64Blob && fileContentType === 'pdf'
    const isImageInput = base64Blob && fileContentType === 'image'

    if (isImageInput && base64Blob) {
      // Compress image
      base64Blob = await compressImage(base64Blob, 512)
    }

    const messages: ChatCompletionMessage[] = [
      activeThreadRef.current.assistants[0]?.instructions,
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
          .filter((e) => e.status !== MessageStatus.Error)
          .map<ChatCompletionMessage>((msg) => ({
            role: msg.role,
            content: msg.content[0]?.text.value ?? '',
          }))
          .concat([
            {
              role: ChatCompletionRole.User,
              content:
                selectedModelRef.current && base64Blob
                  ? [
                      {
                        type: ChatCompletionMessageContentType.Text,
                        text: prompt,
                      },
                      isDocumentInput
                        ? {
                            type: ChatCompletionMessageContentType.Doc,
                            doc_url: {
                              url: `threads/${activeThreadRef.current.id}/files/${msgId}.pdf`,
                            },
                          }
                        : null,
                      isImageInput
                        ? {
                            type: ChatCompletionMessageContentType.Image,
                            image_url: {
                              url: base64Blob,
                            },
                          }
                        : null,
                    ].filter((e) => e !== null)
                  : prompt,
            } as ChatCompletionMessage,
          ])
      )

    let modelRequest =
      selectedModelRef?.current ?? activeThreadRef.current.assistants[0].model

    // Fallback support for previous broken threads
    if (activeThreadRef.current?.assistants[0]?.model?.id === '*') {
      activeThreadRef.current.assistants[0].model = {
        id: modelRequest.id,
        settings: modelRequest.settings,
        parameters: modelRequest.parameters,
      }
    }
    if (runtimeParams.stream == null) {
      runtimeParams.stream = true
    }
    // Add middleware to the model request with tool retrieval enabled
    if (
      activeThreadRef.current.assistants[0].tools?.some(
        (tool: AssistantTool) => tool.type === 'retrieval' && tool.enabled
      )
    ) {
      modelRequest = {
        ...modelRequest,
        // Tool retrieval support document input only for now
        ...(isDocumentInput
          ? {
              engine: InferenceEngine.tool_retrieval_enabled,
              proxy_model: modelRequest.engine,
            }
          : {}),
      }
    }
    const messageRequest: MessageRequest = {
      id: msgId,
      type: MessageRequestType.Thread,
      threadId: activeThreadRef.current.id,
      messages,
      model: {
        ...modelRequest,
        settings: settingParams,
        parameters: runtimeParams,
      },
      thread: activeThreadRef.current,
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
      thread_id: activeThreadRef.current.id,
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
      ...activeThreadRef.current,
      updated: timestamp,
      metadata: {
        ...(activeThreadRef.current.metadata ?? {}),
        lastMessage: prompt,
      },
    }

    // change last update thread when send message
    updateThread(updatedThread)

    await extensionManager
      .get<ConversationalExtension>(ExtensionTypeEnum.Conversational)
      ?.addNewMessage(threadMessage)

    const modelId =
      selectedModelRef.current?.id ??
      activeThreadRef.current.assistants[0].model.id

    if (modelRef.current?.id !== modelId) {
      setQueuedMessage(true)
      await startModel(modelId)
      setQueuedMessage(false)
    }
    setIsGeneratingResponse(true)

    const engine = EngineManager.instance()?.get(
      messageRequest.model?.engine ?? modelRequest.engine ?? ''
    )
    engine?.inference(messageRequest)

    setReloadModel(false)
    setEngineParamsUpdate(false)
  }

  return {
    sendChatMessage,
    resendChatMessage,
  }
}
