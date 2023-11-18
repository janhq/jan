/* eslint-disable @typescript-eslint/no-explicit-any */
import { ReactNode, useEffect, useRef } from 'react'

import {
  events,
  EventName,
  ThreadMessage,
  PluginType,
  MessageStatus,
} from '@janhq/core'
import { ConversationalPlugin, ModelPlugin } from '@janhq/core/lib/plugins'
import { useAtomValue, useSetAtom } from 'jotai'

import { useDownloadState } from '@/hooks/useDownloadState'
import { useGetDownloadedModels } from '@/hooks/useGetDownloadedModels'

import {
  addNewMessageAtom,
  chatMessages,
  updateMessageAtom,
} from '@/helpers/atoms/ChatMessage.atom'
import {
  updateConversationWaitingForResponseAtom,
  userConversationsAtom,
} from '@/helpers/atoms/Conversation.atom'
import { downloadingModelsAtom } from '@/helpers/atoms/Model.atom'
import { pluginManager } from '@/plugin'

export default function EventHandler({ children }: { children: ReactNode }) {
  const addNewMessage = useSetAtom(addNewMessageAtom)
  const updateMessage = useSetAtom(updateMessageAtom)

  const { setDownloadState, setDownloadStateSuccess } = useDownloadState()
  const { downloadedModels, setDownloadedModels } = useGetDownloadedModels()

  const updateConvWaiting = useSetAtom(updateConversationWaitingForResponseAtom)
  const models = useAtomValue(downloadingModelsAtom)
  const messages = useAtomValue(chatMessages)
  const conversations = useAtomValue(userConversationsAtom)
  const messagesRef = useRef(messages)
  const convoRef = useRef(conversations)

  useEffect(() => {
    messagesRef.current = messages
    convoRef.current = conversations
  }, [messages, conversations])

  async function handleNewMessageResponse(message: ThreadMessage) {
    if (message.threadId) {
      const convo = convoRef.current.find((e) => e.id == message.threadId)
      if (!convo) return
      addNewMessage(message)
    }
  }
  async function handleMessageResponseUpdate(messageResponse: ThreadMessage) {
    if (
      messageResponse.threadId &&
      messageResponse.id &&
      messageResponse.content
    ) {
      updateMessage(
        messageResponse.id,
        messageResponse.threadId,
        messageResponse.content,
        MessageStatus.Pending
      )
    }
  }

  async function handleMessageResponseFinished(messageResponse: ThreadMessage) {
    if (!messageResponse.threadId || !convoRef.current) return
    updateConvWaiting(messageResponse.threadId, false)

    if (
      messageResponse.threadId &&
      messageResponse.id &&
      messageResponse.content
    ) {
      updateMessage(
        messageResponse.id,
        messageResponse.threadId,
        messageResponse.content,
        MessageStatus.Ready
      )
    }

    const thread = convoRef.current.find(
      (e) => e.id == messageResponse.threadId
    )
    if (thread) {
      pluginManager
        .get<ConversationalPlugin>(PluginType.Conversational)
        ?.saveConversation({
          ...thread,
          id: thread.id ?? '',
          messages: messagesRef.current[thread.id] ?? [],
        })
    }
  }

  function handleDownloadUpdate(state: any) {
    if (!state) return
    setDownloadState(state)
  }

  function handleDownloadSuccess(state: any) {
    if (state && state.fileName && state.success === true) {
      state.fileName = state.fileName.split('/').pop() ?? ''
      setDownloadStateSuccess(state.fileName)
      const model = models.find((e) => e.id === state.fileName)
      if (model)
        pluginManager
          .get<ModelPlugin>(PluginType.Model)
          ?.saveModel(model)
          .then(() => {
            setDownloadedModels([...downloadedModels, model])
          })
    }
  }

  useEffect(() => {
    if (window.corePlugin.events) {
      events.on(EventName.OnNewMessageResponse, handleNewMessageResponse)
      events.on(EventName.OnMessageResponseUpdate, handleMessageResponseUpdate)
      events.on(
        EventName.OnMessageResponseFinished,
        handleMessageResponseFinished
      )
      events.on(EventName.OnDownloadUpdate, handleDownloadUpdate)
      events.on(EventName.OnDownloadSuccess, handleDownloadSuccess)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    return () => {
      events.off(EventName.OnNewMessageResponse, handleNewMessageResponse)
      events.off(EventName.OnMessageResponseUpdate, handleMessageResponseUpdate)
      events.off(
        EventName.OnMessageResponseFinished,
        handleMessageResponseFinished
      )
      events.off(EventName.OnDownloadUpdate, handleDownloadUpdate)
      events.off(EventName.OnDownloadSuccess, handleDownloadSuccess)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return <>{children}</>
}
