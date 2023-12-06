import { useEffect, useRef, useState } from 'react'

import {
  ChatCompletionMessage,
  ChatCompletionRole,
  ContentType,
  EventName,
  MessageRequest,
  MessageStatus,
  ExtensionType,
  Thread,
  ThreadMessage,
  events,
  Model,
  ConversationalExtension,
  ModelRuntimeParams,
} from '@janhq/core'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'

import { ulid } from 'ulid'

import { selectedModelAtom } from '@/containers/DropdownListSidebar'
import { currentPromptAtom } from '@/containers/Providers/Jotai'

import { toaster } from '@/containers/Toast'

import { useActiveModel } from './useActiveModel'

import { extensionManager } from '@/extension/ExtensionManager'
import {
  addNewMessageAtom,
  getCurrentChatMessagesAtom,
} from '@/helpers/atoms/ChatMessage.atom'
import {
  activeThreadAtom,
  getActiveThreadModelRuntimeParamsAtom,
  threadStatesAtom,
  updateThreadAtom,
  updateThreadInitSuccessAtom,
  updateThreadWaitingForResponseAtom,
} from '@/helpers/atoms/Thread.atom'

export default function useSendChatMessage() {
  const activeThread = useAtomValue(activeThreadAtom)
  const addNewMessage = useSetAtom(addNewMessageAtom)
  const updateThread = useSetAtom(updateThreadAtom)
  const updateThreadWaiting = useSetAtom(updateThreadWaitingForResponseAtom)
  const [currentPrompt, setCurrentPrompt] = useAtom(currentPromptAtom)

  const currentMessages = useAtomValue(getCurrentChatMessagesAtom)
  const { activeModel } = useActiveModel()
  const selectedModel = useAtomValue(selectedModelAtom)
  const { startModel } = useActiveModel()
  const [queuedMessage, setQueuedMessage] = useState(false)

  const modelRef = useRef<Model | undefined>()
  const threadStates = useAtomValue(threadStatesAtom)
  const updateThreadInitSuccess = useSetAtom(updateThreadInitSuccessAtom)
  const activeModelParams = useAtomValue(getActiveThreadModelRuntimeParamsAtom)

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
      await WaitForModelStarting(modelId)
      setQueuedMessage(false)
    }
    events.emit(EventName.OnMessageSent, messageRequest)
  }

  // TODO: Refactor @louis
  const WaitForModelStarting = async (modelId: string) => {
    return new Promise<void>((resolve) => {
      setTimeout(async () => {
        if (modelRef.current?.id !== modelId) {
          console.debug('waiting for model to start')
          await WaitForModelStarting(modelId)
          resolve()
        } else {
          resolve()
        }
      }, 200)
    })
  }

  const sendChatMessage = async () => {
    if (!currentPrompt || currentPrompt.trim().length === 0) {
      return
    }
    if (!activeThread) {
      console.error('No active thread')
      return
    }
    const activeThreadState = threadStates[activeThread.id]

    // if the thread is not initialized, we need to initialize it first
    if (!activeThreadState.isFinishInit) {
      if (!selectedModel) {
        toaster({ title: 'Please select a model' })
        return
      }
      const assistantId = activeThread.assistants[0].assistant_id ?? ''
      const assistantName = activeThread.assistants[0].assistant_name ?? ''
      const instructions = activeThread.assistants[0].instructions ?? ''

      const modelParams: ModelRuntimeParams = {
        ...selectedModel.parameters,
        ...activeModelParams,
      }

      const updatedThread: Thread = {
        ...activeThread,
        assistants: [
          {
            assistant_id: assistantId,
            assistant_name: assistantName,
            instructions: instructions,
            model: {
              id: selectedModel.id,
              settings: selectedModel.settings,
              parameters: modelParams,
              engine: selectedModel.engine,
            },
          },
        ],
      }
      updateThreadInitSuccess(activeThread.id)
      updateThread(updatedThread)

      extensionManager
        .get<ConversationalExtension>(ExtensionType.Conversational)
        ?.saveThread(updatedThread)
    }

    updateThreadWaiting(activeThread.id, true)

    const prompt = currentPrompt.trim()
    setCurrentPrompt('')

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
              content: prompt,
            } as ChatCompletionMessage,
          ])
      )
    const msgId = ulid()
    const messageRequest: MessageRequest = {
      id: msgId,
      threadId: activeThread.id,
      messages,
      model: selectedModel ?? activeThread.assistants[0].model,
    }
    const timestamp = Date.now()
    const threadMessage: ThreadMessage = {
      id: msgId,
      thread_id: activeThread.id,
      role: ChatCompletionRole.User,
      status: MessageStatus.Ready,
      created: timestamp,
      updated: timestamp,
      object: 'thread.message',
      content: [
        {
          type: ContentType.Text,
          text: {
            value: prompt,
            annotations: [],
          },
        },
      ],
    }

    addNewMessage(threadMessage)

    await extensionManager
      .get<ConversationalExtension>(ExtensionType.Conversational)
      ?.addNewMessage(threadMessage)

    const modelId = selectedModel?.id ?? activeThread.assistants[0].model.id

    if (activeModel?.id !== modelId) {
      setQueuedMessage(true)
      startModel(modelId)
      await WaitForModelStarting(modelId)
      setQueuedMessage(false)
    }
    events.emit(EventName.OnMessageSent, messageRequest)
  }

  return {
    sendChatMessage,
    resendChatMessage,
    queuedMessage,
  }
}
