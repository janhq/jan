import { useEffect, useRef } from 'react'

import {
  ChatCompletionRole,
  MessageRequestType,
  ExtensionTypeEnum,
  Thread,
  ThreadMessage,
  Model,
  ConversationalExtension,
  EngineManager,
  ToolManager,
  ThreadAssistantInfo,
  InferenceEngine,
} from '@janhq/core'
import { extractInferenceParams, extractModelLoadParams } from '@janhq/core'
import { atom, useAtom, useAtomValue, useSetAtom } from 'jotai'

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
  engineParamsUpdateAtom,
  getActiveThreadModelParamsAtom,
  isGeneratingResponseAtom,
  updateThreadAtom,
  updateThreadWaitingForResponseAtom,
} from '@/helpers/atoms/Thread.atom'

export const reloadModelAtom = atom(false)

export default function useSendChatMessage() {
  const activeThread = useAtomValue(activeThreadAtom)
  const activeAssistant = useAtomValue(activeAssistantAtom)
  const addNewMessage = useSetAtom(addNewMessageAtom)
  const updateThread = useSetAtom(updateThreadAtom)
  const updateThreadWaiting = useSetAtom(updateThreadWaitingForResponseAtom)
  const setCurrentPrompt = useSetAtom(currentPromptAtom)
  const deleteMessage = useSetAtom(deleteMessageAtom)
  const setEditPrompt = useSetAtom(editPromptAtom)

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

    while (toSendMessage && toSendMessage?.role !== ChatCompletionRole.User) {
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

    if (!activeThreadRef.current || !activeAssistantRef.current) {
      console.error('No active thread or assistant')
      return
    }

    if (selectedModelRef.current?.id === undefined) {
      setModelDropdownState(true)
      return
    }

    if (engineParamsUpdate) setReloadModel(true)
    setTokenSpeed(undefined)

    const runtimeParams = extractInferenceParams(activeModelParams)
    const settingParams = extractModelLoadParams(activeModelParams)

    const prompt = message.trim()

    updateThreadWaiting(activeThreadRef.current.id, true)
    setCurrentPrompt('')
    setEditPrompt('')

    let base64Blob = fileUpload ? await getBase64(fileUpload.file) : undefined

    if (base64Blob && fileUpload?.type === 'image') {
      // Compress image
      base64Blob = await compressImage(base64Blob, 512)
    }

    const modelRequest =
      selectedModelRef?.current ?? activeAssistantRef.current?.model

    // Fallback support for previous broken threads
    if (activeAssistantRef.current?.model?.id === '*') {
      activeAssistantRef.current.model = {
        id: modelRequest.id,
        settings: modelRequest.settings,
        parameters: modelRequest.parameters,
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
      activeThreadRef.current,
      messages ?? currentMessages
    ).addSystemMessage(activeAssistantRef.current?.instructions)

    requestBuilder.pushMessage(prompt, base64Blob, fileUpload)

    // Build Thread Message to persist
    const threadMessageBuilder = new ThreadMessageBuilder(
      requestBuilder
    ).pushMessage(prompt, base64Blob, fileUpload)

    const newMessage = threadMessageBuilder.build()

    // Update thread state
    const updatedThread: Thread = {
      ...activeThreadRef.current,
      updated: newMessage.created_at,
      metadata: {
        ...activeThreadRef.current.metadata,
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
    const modelId =
      selectedModelRef.current?.id ?? activeAssistantRef.current?.model.id

    if (base64Blob) {
      setFileUpload(undefined)
    }

    if (modelRef.current?.id !== modelId && modelId) {
      const error = await startModel(modelId).catch((error: Error) => error)
      if (error) {
        updateThreadWaiting(activeThreadRef.current.id, false)
        return
      }
    }
    setIsGeneratingResponse(true)

    // Process message request with Assistants tools
    const request = await ToolManager.instance().process(
      requestBuilder.build(),
      activeAssistantRef?.current.tools ?? []
    )

    // Request for inference
    EngineManager.instance().get(InferenceEngine.cortex)?.inference(request)

    // Reset states
    setReloadModel(false)
    setEngineParamsUpdate(false)
  }

  return {
    sendChatMessage,
    resendChatMessage,
  }
}
