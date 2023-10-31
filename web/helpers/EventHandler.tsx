import { addNewMessageAtom, updateMessageAtom } from './atoms/ChatMessage.atom'
import { toChatMessage } from '@models/ChatMessage'
import { events, EventName, NewMessageResponse, DataService } from '@janhq/core'
import { useSetAtom } from 'jotai'
import { ReactNode, useEffect } from 'react'
import useGetBots from '@hooks/useGetBots'
import useGetUserConversations from '@hooks/useGetUserConversations'
import {
  updateConversationAtom,
  updateConversationWaitingForResponseAtom,
} from './atoms/Conversation.atom'
import { executeSerial } from '@plugin/extension-manager'
import { debounce } from 'lodash'
import {
  setDownloadStateAtom,
  setDownloadStateSuccessAtom,
} from './atoms/DownloadState.atom'
import { downloadedModelAtom } from './atoms/DownloadedModel.atom'
import { ModelManagementService } from '@janhq/core'
import { getDownloadedModels } from '../hooks/useGetDownloadedModels'

let currentConversation: Conversation | undefined = undefined

const debouncedUpdateConversation = debounce(
  async (updatedConv: Conversation) => {
    await executeSerial(DataService.UpdateConversation, updatedConv)
  },
  1000
)

export default function EventHandler({ children }: { children: ReactNode }) {
  const addNewMessage = useSetAtom(addNewMessageAtom)
  const updateMessage = useSetAtom(updateMessageAtom)
  const updateConversation = useSetAtom(updateConversationAtom)
  const { getBotById } = useGetBots()
  const { getConversationById } = useGetUserConversations()

  const updateConvWaiting = useSetAtom(updateConversationWaitingForResponseAtom)
  const setDownloadState = useSetAtom(setDownloadStateAtom)
  const setDownloadStateSuccess = useSetAtom(setDownloadStateSuccessAtom)
  const setDownloadedModels = useSetAtom(downloadedModelAtom)

  async function handleNewMessageResponse(message: NewMessageResponse) {
    if (message.conversationId) {
      const convo = await getConversationById(message.conversationId)
      const botId = convo?.botId
      console.debug('botId', botId)
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
        currentConversation = await getConversationById(
          messageResponse.conversationId
        )
      }

      const updatedConv: Conversation = {
        ...currentConversation,
        lastMessage: messageResponse.message,
      }

      updateConversation(updatedConv)
      debouncedUpdateConversation(updatedConv)
    }
  }

  async function handleMessageResponseFinished(
    messageResponse: NewMessageResponse
  ) {
    if (!messageResponse.conversationId) return
    console.debug('handleMessageResponseFinished', messageResponse)
    updateConvWaiting(messageResponse.conversationId, false)
  }

  function handleDownloadUpdate(state: any) {
    if (!state) return
    setDownloadState(state)
  }

  function handleDownloadSuccess(state: any) {
    if (state && state.fileName && state.success === true) {
      setDownloadStateSuccess(state.fileName)
      executeSerial(
        ModelManagementService.UpdateFinishedDownloadAt,
        state.fileName
      ).then(() => {
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
        'OnMessageResponseFinished',
        // EventName.OnMessageResponseFinished,
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
        'OnMessageResponseFinished',
        // EventName.OnMessageResponseFinished,
        handleMessageResponseFinished
      )
      events.off(EventName.OnDownloadUpdate, handleDownloadUpdate)
      events.off(EventName.OnDownloadSuccess, handleDownloadSuccess)
    }
  }, [])
  return <>{children}</>
}
