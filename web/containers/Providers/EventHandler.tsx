/* eslint-disable @typescript-eslint/no-explicit-any */
import { ReactNode, useEffect } from 'react'

import { events, EventName, NewMessageResponse, DataService } from '@janhq/core'

import { useSetAtom } from 'jotai'
import { debounce } from 'lodash'
import useGetBots from '@/hooks/useGetBots'
import { getDownloadedModels } from '@/hooks/useGetDownloadedModels'
import { useGetDownloadedModels } from '@/hooks/useGetDownloadedModels'
import useGetUserConversations from '@/hooks/useGetUserConversations'

import {
  addNewMessageAtom,
  updateMessageAtom,
} from '@/helpers/atoms/ChatMessage.atom'
import {
  updateConversationAtom,
  updateConversationWaitingForResponseAtom,
} from '@/helpers/atoms/Conversation.atom'
import {
  setDownloadStateAtom,
  setDownloadStateSuccessAtom,
} from '@/helpers/atoms/DownloadState.atom'

import { toChatMessage } from '@/models/ChatMessage'

let currentConversation: Conversation | undefined = undefined

export default function EventHandler({ children }: { children: ReactNode }) {
  const addNewMessage = useSetAtom(addNewMessageAtom)
  const updateMessage = useSetAtom(updateMessageAtom)
  const updateConversation = useSetAtom(updateConversationAtom)
  const { getBotById } = useGetBots()
  const { setDownloadedModels } = useGetDownloadedModels()

  const updateConvWaiting = useSetAtom(updateConversationWaitingForResponseAtom)
  const setDownloadState = useSetAtom(setDownloadStateAtom)
  const setDownloadStateSuccess = useSetAtom(setDownloadStateSuccessAtom)
  const setDownloadedModels = useSetAtom(downloadedModelAtom)
  const models = useAtomValue(downloadingModelsAtom)
  const messages = useAtomValue(chatMessages)
  const conversations = useAtomValue(userConversationsAtom)
  const messagesRef = useRef(messages)
  const convoRef = useRef(conversations)

  useEffect(() => {
    messagesRef.current = messages
    convoRef.current = conversations
  }, [messages, conversations])

  async function handleNewMessageResponse(message: NewMessageResponse) {
    if (message.conversationId) {
      const convo = convoRef.current.find(
        (e) => e._id == message.conversationId
      )
      if (!convo) return
      const botId = convo?.botId
      if (botId) {
        const bot = await getBotById(botId)
        const newResponse = toChatMessage(message, bot)
        addNewMessage(newResponse)
      } else {
        const newResponse = toChatMessage(message)
        addNewMessage(newResponse)
      }
    }
  }
  async function handleMessageResponseUpdate(
    messageResponse: NewMessageResponse
  ) {
    if (
      messageResponse.conversationId &&
      messageResponse._id &&
      messageResponse.message
    ) {
      updateMessage(
        messageResponse._id,
        messageResponse.conversationId,
        messageResponse.message
      )
    }

    if (messageResponse.conversationId) {
      if (
        !currentConversation ||
        currentConversation._id !== messageResponse.conversationId
      ) {
        if (convoRef.current && messageResponse.conversationId)
          currentConversation = convoRef.current.find(
            (e) => e._id == messageResponse.conversationId
          )
      }

      if (currentConversation) {
        const updatedConv: Conversation = {
          ...currentConversation,
          lastMessage: messageResponse.message,
        }

        updateConversation(updatedConv)
      }
    }
  }

  async function handleMessageResponseFinished(
    messageResponse: NewMessageResponse
  ) {
    if (!messageResponse.conversationId || !convoRef.current) return
    updateConvWaiting(messageResponse.conversationId, false)

    const convo = convoRef.current.find(
      (e) => e._id == messageResponse.conversationId
    )
    if (convo) {
      const messagesData = (messagesRef.current ?? [])[convo._id].map<Message>(
        (e: ChatMessage) => {
          return {
            _id: e.id,
            message: e.text,
            user: e.senderUid,
            updatedAt: new Date(e.createdAt).toISOString(),
            createdAt: new Date(e.createdAt).toISOString(),
          }
        }
      )
      pluginManager
        .get<ConversationalPlugin>(PluginType.Conversational)
        ?.saveConversation({
          ...convo,
          _id: convo._id ?? '',
          name: convo.name ?? '',
          messages: messagesData,
        })
    }
  }

  function handleDownloadUpdate(state: any) {
    if (!state) return
    setDownloadState(state)
  }

  function handleDownloadSuccess(state: any) {
    if (state && state.fileName && state.success === true) {
      setDownloadStateSuccess(state.fileName)
      const model = models.find((e) => e._id === state.fileName)
      if (model)
        pluginManager
          .get<ModelPlugin>(PluginType.Model)
          ?.saveModel(model)
          .then(() => {
            getDownloadedModels().then((models) => {
              setDownloadedModels(models)
            })
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
