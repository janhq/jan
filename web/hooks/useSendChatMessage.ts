import {
  EventName,
  MessageHistory,
  NewMessageRequest,
  PluginType,
  events,
  ChatMessage,
  Message,
  Conversation,
  MessageSenderType,
} from '@janhq/core'
import { ConversationalPlugin, InferencePlugin } from '@janhq/core/lib/plugins'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { currentPromptAtom } from '@/containers/Providers/Jotai'
import { ulid } from 'ulid'
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
import { toChatMessage } from '@/utils/message'

export default function useSendChatMessage() {
  const currentConvo = useAtomValue(currentConversationAtom)
  const addNewMessage = useSetAtom(addNewMessageAtom)
  const updateConversation = useSetAtom(updateConversationAtom)
  const updateConvWaiting = useSetAtom(updateConversationWaitingForResponseAtom)
  const [currentPrompt, setCurrentPrompt] = useAtom(currentPromptAtom)
  const currentMessages = useAtomValue(getCurrentChatMessagesAtom)

  let timeout: NodeJS.Timeout | undefined = undefined

  function updateConvSummary(newMessage: NewMessageRequest) {
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
        // Request convo summary
        setTimeout(async () => {
          newMessage.message =
            'summary this conversation in 5 words, the response should just include the summary'
          const result = await pluginManager
            .get<InferencePlugin>(PluginType.Inference)
            ?.inferenceRequest(newMessage)

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
                name: updatedConv.name ?? '',
                message: updatedConv.lastMessage ?? '',
                messages: currentMessages.map<Message>((e: ChatMessage) => ({
                  id: e.id,
                  message: e.text,
                  user: e.senderUid,
                  updatedAt: new Date(e.createdAt).toISOString(),
                  createdAt: new Date(e.createdAt).toISOString(),
                })),
              })
          }
        }, 1000)
      }
    }, 100)
  }

  const sendChatMessage = async () => {
    const convoId = currentConvo?.id
    if (!convoId) {
      console.error('No conversation id')
      return
    }

    setCurrentPrompt('')
    updateConvWaiting(convoId, true)

    const prompt = currentPrompt.trim()
    const messageHistory: MessageHistory[] = currentMessages
      .map((msg) => ({
        role: msg.senderUid,
        content: msg.text ?? '',
      }))
      .reverse()
      .concat([
        {
          role: MessageSenderType.User,
          content: prompt,
        } as MessageHistory,
      ])
    const newMessage: NewMessageRequest = {
      id: ulid(),
      conversationId: convoId,
      message: prompt,
      user: MessageSenderType.User,
      createdAt: new Date().toISOString(),
      history: messageHistory,
    }

    const newChatMessage = toChatMessage(newMessage)
    addNewMessage(newChatMessage)

    // delay randomly from 50 - 100ms
    // to prevent duplicate message id
    const delay = Math.floor(Math.random() * 50) + 50
    await new Promise((resolve) => setTimeout(resolve, delay))

    events.emit(EventName.OnNewMessageRequest, newMessage)
    if (!currentConvo?.summary && currentConvo) {
      const updatedConv: Conversation = {
        ...currentConvo,
        lastMessage: prompt,
        summary: `Prompt: ${prompt}`,
      }

      updateConversation(updatedConv)
    } else if (currentConvo) {
      const updatedConv: Conversation = {
        ...currentConvo,
        lastMessage: prompt,
      }

      updateConversation(updatedConv)
    }

    updateConvSummary(newMessage)
  }

  return {
    sendChatMessage,
  }
}
