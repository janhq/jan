import { Fragment, ReactNode, useCallback, useEffect, useRef } from 'react'

import {
  ChatCompletionMessage,
  ChatCompletionRole,
  events,
  ThreadMessage,
  ExtensionTypeEnum,
  MessageStatus,
  MessageRequest,
  ConversationalExtension,
  MessageEvent,
  MessageRequestType,
  ModelEvent,
  Thread,
  EngineManager,
  InferenceEngine,
  extractInferenceParams,
} from '@janhq/core'
import { useAtomValue, useSetAtom } from 'jotai'
import { ulid } from 'ulidx'

import { activeModelAtom, stateModelAtom } from '@/hooks/useActiveModel'

import { isLocalEngine } from '@/utils/modelEngine'

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
  getActiveThreadModelParamsAtom,
} from '@/helpers/atoms/Thread.atom'

const maxWordForThreadTitle = 10
const defaultThreadTitle = 'New Thread'

export default function EventHandler({ children }: { children: ReactNode }) {
  const messages = useAtomValue(getCurrentChatMessagesAtom)
  const addNewMessage = useSetAtom(addNewMessageAtom)
  const updateMessage = useSetAtom(updateMessageAtom)
  const downloadedModels = useAtomValue(downloadedModelsAtom)
  const activeModel = useAtomValue(activeModelAtom)
  const setActiveModel = useSetAtom(activeModelAtom)
  const setStateModel = useSetAtom(stateModelAtom)

  const updateThreadWaiting = useSetAtom(updateThreadWaitingForResponseAtom)
  const threads = useAtomValue(threadsAtom)
  const modelsRef = useRef(downloadedModels)
  const threadsRef = useRef(threads)
  const setIsGeneratingResponse = useSetAtom(isGeneratingResponseAtom)
  const updateThread = useSetAtom(updateThreadAtom)
  const messagesRef = useRef(messages)
  const activeModelRef = useRef(activeModel)
  const activeModelParams = useAtomValue(getActiveThreadModelParamsAtom)
  const activeModelParamsRef = useRef(activeModelParams)

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

  useEffect(() => {
    activeModelParamsRef.current = activeModelParams
  }, [activeModelParams])

  const onNewMessageResponse = useCallback(
    (message: ThreadMessage) => {
      if (message.type === MessageRequestType.Thread) {
        addNewMessage(message)
      }
    },
    [addNewMessage]
  )

  const onModelStopped = useCallback(() => {
    setActiveModel(undefined)
    setStateModel({ state: 'start', loading: false, model: undefined })
  }, [setActiveModel, setStateModel])

  const updateThreadTitle = useCallback(
    (message: ThreadMessage) => {
      // Update only when it's finished
      if (message.status !== MessageStatus.Ready) {
        return
      }

      const thread = threadsRef.current?.find((e) => e.id == message.thread_id)
      if (!thread) {
        console.warn(
          `Failed to update title for thread ${message.thread_id}: Thread not found!`
        )
        return
      }

      const messageContent = message.content[0]?.text?.value
      if (!messageContent) {
        console.warn(
          `Failed to update title for thread ${message.thread_id}: Responded content is null!`
        )
        return
      }

      // The thread title should not be updated if the message is less than 10 words
      // And no new line character is present
      // And non-alphanumeric characters should be removed
      if (messageContent.includes('\n')) {
        console.warn(
          `Failed to update title for thread ${message.thread_id}: Title can't contain new line character!`
        )
        return
      }

      // Remove non-alphanumeric characters
      const cleanedMessageContent = messageContent
        .replace(/[^a-z0-9\s]/gi, '')
        .trim()

      // Split the message into words
      const words = cleanedMessageContent.split(' ')

      if (words.length >= maxWordForThreadTitle) {
        console.warn(
          `Failed to update title for thread ${message.thread_id}: Title can't be greater than ${maxWordForThreadTitle} words!`
        )
        return
      }

      const updatedThread: Thread = {
        ...thread,

        title: cleanedMessageContent,
        metadata: thread.metadata,
      }

      extensionManager
        .get<ConversationalExtension>(ExtensionTypeEnum.Conversational)
        ?.saveThread({
          ...updatedThread,
        })
        .then(() => {
          // Update the Thread title with the response of the inference on the 1st prompt
          updateThread({
            ...updatedThread,
          })
        })
    },
    [updateThread]
  )

  const updateThreadMessage = useCallback(
    (message: ThreadMessage) => {
      updateMessage(
        message.id,
        message.thread_id,
        message.content,
        message.status
      )
      if (message.status === MessageStatus.Pending) {
        if (message.content.length) {
          setIsGeneratingResponse(false)
        }
        return
      } else if (message.status === MessageStatus.Error) {
        setActiveModel(undefined)
        setStateModel({ state: 'start', loading: false, model: undefined })
      }
      // Mark the thread as not waiting for response
      updateThreadWaiting(message.thread_id, false)

      setIsGeneratingResponse(false)

      const thread = threadsRef.current?.find((e) => e.id == message.thread_id)
      if (!thread) return
      const messageContent = message.content[0]?.text?.value
      const metadata = {
        ...thread.metadata,
        ...(messageContent && { lastMessage: messageContent }),
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
      extensionManager
        .get<ConversationalExtension>(ExtensionTypeEnum.Conversational)
        ?.addNewMessage(message)

      // Attempt to generate the title of the Thread when needed
      generateThreadTitle(message, thread)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setIsGeneratingResponse, updateMessage, updateThread, updateThreadWaiting]
  )

  const onMessageResponseUpdate = useCallback(
    (message: ThreadMessage) => {
      switch (message.type) {
        case MessageRequestType.Summary:
          updateThreadTitle(message)
          break
        default:
          updateThreadMessage(message)
          break
      }
    },
    [updateThreadMessage, updateThreadTitle]
  )

  const generateThreadTitle = (message: ThreadMessage, thread: Thread) => {
    // If this is the first ever prompt in the thread
    if (thread.title?.trim() !== defaultThreadTitle) {
      return
    }

    if (!activeModelRef.current) {
      return
    }

    // Check model engine; we don't want to generate a title when it's not a local engine. remote model using first promp
    if (!isLocalEngine(activeModelRef.current?.engine as InferenceEngine)) {
      const updatedThread: Thread = {
        ...thread,
        title: (thread.metadata?.lastMessage as string) || defaultThreadTitle,
        metadata: thread.metadata,
      }
      return extensionManager
        .get<ConversationalExtension>(ExtensionTypeEnum.Conversational)
        ?.saveThread({
          ...updatedThread,
        })
        .then(() => {
          updateThread({
            ...updatedThread,
          })
        })
    }

    // This is the first time message comes in on a new thread
    // Summarize the first message, and make that the title of the Thread
    // 1. Get the summary of the first prompt using whatever engine user is currently using
    const threadMessages = messagesRef?.current

    if (!threadMessages || threadMessages.length === 0) return

    const summarizeFirstPrompt = `Summarize in a ${maxWordForThreadTitle}-word Title. Give the title only. "${threadMessages[0].content[0].text.value}"`

    // Prompt: Given this query from user {query}, return to me the summary in 10 words as the title
    const msgId = ulid()
    const messages: ChatCompletionMessage[] = [
      {
        role: ChatCompletionRole.User,
        content: summarizeFirstPrompt,
      },
    ]

    const runtimeParams = extractInferenceParams(activeModelParamsRef.current)

    const messageRequest: MessageRequest = {
      id: msgId,
      threadId: message.thread_id,
      type: MessageRequestType.Summary,
      messages,
      model: {
        ...activeModelRef.current,
        parameters: {
          ...runtimeParams,
          stream: false,
        },
      },
    }

    // 2. Update the title with the result of the inference
    setTimeout(() => {
      const engine = EngineManager.instance().get(
        messageRequest.model?.engine ?? activeModelRef.current?.engine ?? ''
      )
      engine?.inference(messageRequest)
    }, 1000)
  }

  useEffect(() => {
    if (window.core?.events) {
      events.on(MessageEvent.OnMessageResponse, onNewMessageResponse)
      events.on(MessageEvent.OnMessageUpdate, onMessageResponseUpdate)
      events.on(ModelEvent.OnModelStopped, onModelStopped)
    }

    return () => {
      events.off(MessageEvent.OnMessageResponse, onNewMessageResponse)
      events.off(MessageEvent.OnMessageUpdate, onMessageResponseUpdate)
      events.off(ModelEvent.OnModelStopped, onModelStopped)
    }
  }, [onNewMessageResponse, onMessageResponseUpdate, onModelStopped])

  return <Fragment>{children}</Fragment>
}
