import {
  EventName,
  MessageHistory,
  NewMessageRequest,
  PluginType,
  events,
} from '@janhq/core'

import { InferencePlugin } from '@janhq/core/lib/plugins'

import { useAtom, useAtomValue, useSetAtom } from 'jotai'

import { currentPromptAtom } from '@/containers/Providers/Jotai'

import { generateMessageId } from '@/utils/message'

import {
  addNewMessageAtom,
  getCurrentChatMessagesAtom,
} from '@/helpers/atoms/ChatMessage.atom'
import {
  currentConversationAtom,
  updateConversationAtom,
  updateConversationWaitingForResponseAtom,
} from '@/helpers/atoms/Conversation.atom'
import { toChatMessage } from '@/models/ChatMessage'

import { pluginManager } from '@/plugin/PluginManager'

export default function useSendChatMessage() {
  // const { activeModel } = useActiveModel()
  // const { requestCreateConvo } = useCreateConversation()
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
            conv?._id
          ) {
            const updatedConv = {
              ...conv,
              summary: result.message,
            }
            updateConversation(updatedConv)
          }
        }, 1000)
      }
    }, 100)
  }

  const sendChatMessage = async () => {
    const convoId = currentConvo?._id as string

    setCurrentPrompt('')
    updateConvWaiting(convoId, true)

    const prompt = currentPrompt.trim()
    const messageHistory: MessageHistory[] = currentMessages
      .map((msg) => {
        return {
          role: msg.senderUid === 'user' ? 'user' : 'assistant',
          content: msg.text ?? '',
        }
      })
      .reverse()
      .concat([
        {
          role: 'user',
          content: prompt,
        } as MessageHistory,
      ])
    const newMessage: NewMessageRequest = {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      _id: generateMessageId(),
      conversationId: convoId,
      message: prompt,
      user: 'user',
      createdAt: new Date().toISOString(),
      history: messageHistory,
    }

    const newChatMessage = toChatMessage(newMessage)
    addNewMessage(newChatMessage)

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

  // if (!currentConvo?._id) {
  //   requestCreateConvo(activeModel as AssistantModel)
  //   sendChatMessage()
  // }

  return {
    sendChatMessage,
  }
}
