/* eslint-disable @typescript-eslint/no-explicit-any */
import { ReactNode, useCallback, useEffect, useRef } from 'react'

import {
  ChatCompletionMessage,
  ChatCompletionRole,
  events,
  ThreadMessage,
  ExtensionTypeEnum,
  MessageStatus,
  MessageRequest,
  Model,
  ConversationalExtension,
  MessageEvent,
  MessageRequestType,
  ModelEvent,
} from '@janhq/core'
import { useAtomValue, useSetAtom } from 'jotai'
import { ulid } from 'ulid'

import {
  activeModelAtom,
  loadModelErrorAtom,
  stateModelAtom,
} from '@/hooks/useActiveModel'

import { queuedMessageAtom } from '@/hooks/useSendChatMessage'

import { toaster } from '../Toast'

import { extensionManager } from '@/extension'
import {
  getCurrentChatMessagesAtom,
  addNewMessageAtom,
  updateMessageAtom,
} from '@/helpers/atoms/ChatMessage.atom'
import { downloadedModelsAtom } from '@/helpers/atoms/Model.atom'
import {
  updateThreadWaitingForResponseAtom,
  threadsAtom,
  isGeneratingResponseAtom,
  updateThreadAtom,
} from '@/helpers/atoms/Thread.atom'

export default function EventHandler({ children }: { children: ReactNode }) {
  const messages = useAtomValue(getCurrentChatMessagesAtom)
  const addNewMessage = useSetAtom(addNewMessageAtom)
  const updateMessage = useSetAtom(updateMessageAtom)
  const downloadedModels = useAtomValue(downloadedModelsAtom)
  const activeModel = useAtomValue(activeModelAtom)
  const setActiveModel = useSetAtom(activeModelAtom)
  const setStateModel = useSetAtom(stateModelAtom)
  const setQueuedMessage = useSetAtom(queuedMessageAtom)
  const setLoadModelError = useSetAtom(loadModelErrorAtom)

  const updateThreadWaiting = useSetAtom(updateThreadWaitingForResponseAtom)
  const threads = useAtomValue(threadsAtom)
  const modelsRef = useRef(downloadedModels)
  const threadsRef = useRef(threads)
  const setIsGeneratingResponse = useSetAtom(isGeneratingResponseAtom)
  const updateThread = useSetAtom(updateThreadAtom)
  const messagesRef = useRef(messages)
  const activeModelRef = useRef(activeModel)

  useEffect(() => {
    threadsRef.current = threads
  }, [threads])

  useEffect(() => {
    modelsRef.current = downloadedModels
  }, [downloadedModels])

  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  useEffect(() => {
    activeModelRef.current = activeModel
  }, [activeModel])

  const onNewMessageResponse = useCallback(
    (message: ThreadMessage) => {
      const thread = threadsRef.current?.find((e) => e.id == message.thread_id)
      // If this is the first ever prompt in the thread
      if (thread && thread.title.trim() == 'New Thread') {
        // This is the first time message comes in on a new thread
        //  Summarize the first message, and make that the title of the Thread
        // 1. Get the summary of the first prompt using whatever engine user is currently using
        const firstPrompt = messagesRef?.current[0].content[0].text.value.trim()
        const summarizeFirstPrompt =
          'Summarize "' + firstPrompt + '" in 5 words as a title'

        // Prompt: Given this query from user {query}, return to me the summary in 5 words as the title
        const msgId = ulid()
        const messages: ChatCompletionMessage[] = [
          {
            role: ChatCompletionRole.User,
            content: summarizeFirstPrompt,
          } as ChatCompletionMessage,
        ]

        const firstPromptRequest: MessageRequest = {
          id: msgId,
          threadId: message.thread_id,
          type: MessageRequestType.Summary,
          messages,
          model: activeModelRef?.current,
        }

        // 2. Update the title with the result of the inference
        //      the title will be updated as part of the `EventName.OnFirstPromptUpdate`
        events.emit(MessageEvent.OnMessageSent, firstPromptRequest)
      }

      if (message.type !== MessageRequestType.Summary) {
        addNewMessage(message)
      }
    },
    [addNewMessage]
  )

  const onModelReady = useCallback(
    (model: Model) => {
      setActiveModel(model)
      toaster({
        title: 'Success!',
        description: `Model ${model.id} has been started.`,
        type: 'success',
      })
      setStateModel(() => ({
        state: 'stop',
        loading: false,
        model: model.id,
      }))
    },
    [setActiveModel, setStateModel]
  )

  const onModelStopped = useCallback(() => {
    setTimeout(() => {
      setActiveModel(undefined)
      setStateModel({ state: 'start', loading: false, model: '' })
    }, 500)
  }, [setActiveModel, setStateModel])

  const onModelInitFailed = useCallback(
    (res: any) => {
      const errorMessage = `${res.error}`
      console.error('Failed to load model: ' + errorMessage)
      setStateModel(() => ({
        state: 'start',
        loading: false,
        model: res.modelId,
      }))
      setLoadModelError(errorMessage)
      setQueuedMessage(false)
    },
    [setStateModel, setQueuedMessage, setLoadModelError]
  )

  const onMessageResponseUpdate = useCallback(
    (message: ThreadMessage) => {
      updateMessage(
        message.id,
        message.thread_id,
        message.content,
        message.status
      )
      if (message.status === MessageStatus.Pending) {
        if (message.content.length) {
          updateThreadWaiting(message.thread_id, false)
          setIsGeneratingResponse(false)
        }
        return
      }
      // Mark the thread as not waiting for response
      updateThreadWaiting(message.thread_id, false)

      setIsGeneratingResponse(false)

      const thread = threadsRef.current?.find((e) => e.id == message.thread_id)
      if (thread) {
        const messageContent = message.content[0]?.text?.value
        const metadata = {
          ...thread.metadata,
          ...(messageContent && { lastMessage: messageContent }),
        }

        // Update the Thread title with the response of the inference on the 1st prompt
        if (message.type === MessageRequestType.Summary) {
          thread.title = messageContent
        }

        updateThread({
          ...thread,
          metadata,
        })

        extensionManager
          .get<ConversationalExtension>(ExtensionTypeEnum.Conversational)
          ?.saveThread({
            ...thread,
            metadata,
          })

        // If this is not the summary of the Thread, don't need to add it to the Thread
        if (message.type !== MessageRequestType.Summary) {
          extensionManager
            .get<ConversationalExtension>(ExtensionTypeEnum.Conversational)
            ?.addNewMessage(message)
        }
      }
    },
    [updateMessage, updateThreadWaiting, setIsGeneratingResponse, updateThread]
  )

  useEffect(() => {
    console.log('Registering events')
    if (window.core?.events) {
      events.on(MessageEvent.OnMessageResponse, onNewMessageResponse)
      events.on(MessageEvent.OnMessageUpdate, onMessageResponseUpdate)

      events.on(ModelEvent.OnModelReady, onModelReady)
      events.on(ModelEvent.OnModelFail, onModelInitFailed)
      events.on(ModelEvent.OnModelStopped, onModelStopped)
    }
  }, [
    onNewMessageResponse,
    onMessageResponseUpdate,
    onModelReady,
    onModelInitFailed,
    onModelStopped,
  ])

  useEffect(() => {
    return () => {
      events.off(MessageEvent.OnMessageResponse, onNewMessageResponse)
      events.off(MessageEvent.OnMessageUpdate, onMessageResponseUpdate)
    }
  }, [onNewMessageResponse, onMessageResponseUpdate])
  return <>{children}</>
}
