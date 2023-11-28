import {
  ChatCompletionMessage,
  ChatCompletionRole,
  EventName,
  MessageRequest,
  MessageStatus,
  PluginType,
  ThreadMessage,
  events,
} from '@janhq/core'
import { ConversationalPlugin, InferencePlugin } from '@janhq/core/lib/plugins'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'

import { ulid } from 'ulid'

import { currentPromptAtom } from '@/containers/Providers/Jotai'

import { useActiveModel } from './useActiveModel'

import {
  addNewMessageAtom,
  getCurrentChatMessagesAtom,
} from '@/helpers/atoms/ChatMessage.atom'
import {
  currentConversationAtom,
  updateConversationAtom,
  updateConversationWaitingForResponseAtom,
} from '@/helpers/atoms/Conversation.atom'
import { pluginManager } from '@/plugin/PluginManager'

export default function useSendChatMessage() {
  const currentConvo = useAtomValue(currentConversationAtom)
  const addNewMessage = useSetAtom(addNewMessageAtom)
  const updateConversation = useSetAtom(updateConversationAtom)
  const updateConvWaiting = useSetAtom(updateConversationWaitingForResponseAtom)
  const [currentPrompt, setCurrentPrompt] = useAtom(currentPromptAtom)
  const currentMessages = useAtomValue(getCurrentChatMessagesAtom)
  const { activeModel } = useActiveModel()

  function updateConvSummary(newMessage: MessageRequest) {
    if (
      currentConvo &&
      newMessage.messages &&
      newMessage.messages.length >= 2 &&
      (!currentConvo.summary ||
        currentConvo.summary === '' ||
        currentConvo.summary === activeModel?.name)
    ) {
      const summaryMsg: ChatCompletionMessage = {
        role: ChatCompletionRole.User,
        content:
          'summary this conversation in less than 5 words, the response should just include the summary',
      }
      // Request convo summary
      setTimeout(async () => {
        const result = await pluginManager
          .get<InferencePlugin>(PluginType.Inference)
          ?.inferenceRequest({
            ...newMessage,
            messages: newMessage.messages?.slice(0, -1).concat([summaryMsg]),
          })
          .catch(console.error)
        if (
          currentConvo &&
          currentConvo.id === newMessage.threadId &&
          result?.content &&
          result?.content?.trim().length > 0 &&
          result.content.split(' ').length <= 20
        ) {
          const updatedConv = {
            ...currentConvo,
            summary: result.content,
          }
          updateConversation(updatedConv)
          pluginManager
            .get<ConversationalPlugin>(PluginType.Conversational)
            ?.saveConversation({
              ...updatedConv,
              messages: currentMessages,
            })
        }
      }, 1000)
    }
  }

  const sendChatMessage = async () => {
    const threadId = currentConvo?.id
    if (!threadId) {
      console.error('No conversation id')
      return
    }

    setCurrentPrompt('')
    updateConvWaiting(threadId, true)

    const prompt = currentPrompt.trim()
    const messages: ChatCompletionMessage[] = currentMessages
      .map<ChatCompletionMessage>((msg) => ({
        role: msg.role ?? ChatCompletionRole.User,
        content: msg.content ?? '',
      }))
      .reverse()
      .concat([
        {
          role: ChatCompletionRole.User,
          content: prompt,
        } as ChatCompletionMessage,
      ])
    const messageRequest: MessageRequest = {
      id: ulid(),
      threadId: threadId,
      messages,
    }

    const threadMessage: ThreadMessage = {
      id: messageRequest.id,
      threadId: messageRequest.threadId,
      content: prompt,
      role: ChatCompletionRole.User,
      createdAt: new Date().toISOString(),
      status: MessageStatus.Ready,
    }
    addNewMessage(threadMessage)

    events.emit(EventName.OnNewMessageRequest, messageRequest)
    updateConvSummary(messageRequest)
  }

  return {
    sendChatMessage,
  }
}
