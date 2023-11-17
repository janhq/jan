import {
  ChatCompletionMessage,
  ChatCompletionRole,
  EventName,
  MessageRequest,
  MessageStatus,
  PluginType,
  Thread,
  ThreadMessage,
  events,
} from '@janhq/core'
import { ConversationalPlugin, InferencePlugin } from '@janhq/core/lib/plugins'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'

import { ulid } from 'ulid'

import { currentPromptAtom } from '@/containers/Providers/Jotai'

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

  let timeout: NodeJS.Timeout | undefined = undefined

  function updateConvSummary(newMessage: MessageRequest) {
    if (timeout) {
      clearTimeout(timeout)
    }
    timeout = setTimeout(() => {
      const conv = currentConvo
      if (
        !currentConvo?.summary ||
        currentConvo.summary === '' ||
        currentConvo.summary.startsWith('Prompt:')
      ) {
        const summaryMsg: ChatCompletionMessage = {
          role: ChatCompletionRole.User,
          content:
            'summary this conversation in 5 words, the response should just include the summary',
        }
        // Request convo summary
        setTimeout(async () => {
          const result = await pluginManager
            .get<InferencePlugin>(PluginType.Inference)
            ?.inferenceRequest({
              ...newMessage,
              messages: newMessage.messages?.concat([summaryMsg]),
            })

          if (
            result?.message &&
            result.message.split(' ').length <= 10 &&
            conv?.id
          ) {
            const updatedConv = {
              ...conv,
              summary: result.message,
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
    }, 100)
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
    if (!currentConvo?.summary && currentConvo) {
      const updatedConv: Thread = {
        ...currentConvo,
        summary: `Prompt: ${prompt}`,
      }

      updateConversation(updatedConv)
    }

    updateConvSummary(messageRequest)
  }

  return {
    sendChatMessage,
  }
}
