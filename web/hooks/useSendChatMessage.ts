import {
  ChatCompletionMessage,
  ChatCompletionRole,
  ContentType,
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

import { useActiveModel } from './useActiveModel'

import {
  addNewMessageAtom,
  getCurrentChatMessagesAtom,
} from '@/helpers/atoms/ChatMessage.atom'
import {
  activeThreadAtom,
  updateThreadAtom,
  updateConversationWaitingForResponseAtom,
} from '@/helpers/atoms/Conversation.atom'
import { pluginManager } from '@/plugin/PluginManager'
import { selectedModelAtom } from '@/containers/DropdownListSidebar'

export default function useSendChatMessage() {
  const activeThread = useAtomValue(activeThreadAtom)
  const addNewMessage = useSetAtom(addNewMessageAtom)
  const updateThread = useSetAtom(updateThreadAtom)
  const updateConvWaiting = useSetAtom(updateConversationWaitingForResponseAtom)
  const [currentPrompt, setCurrentPrompt] = useAtom(currentPromptAtom)

  const currentMessages = useAtomValue(getCurrentChatMessagesAtom)
  const { activeModel } = useActiveModel()
  const selectedModel = useAtomValue(selectedModelAtom)

  function updateThreadTitle(newMessage: MessageRequest) {
    if (
      activeThread &&
      newMessage.messages &&
      newMessage.messages.length > 2 &&
      (activeThread.title === '' || activeThread.title === activeModel?.name)
    ) {
      const summaryMsg: ChatCompletionMessage = {
        role: ChatCompletionRole.User,
        content:
          'Summarize this conversation in less than 5 words, the response should just include the summary',
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
        const content = result?.content[0]?.text.value.trim()
        if (
          activeThread &&
          activeThread.id === newMessage.threadId &&
          content &&
          content.length > 0 &&
          content.split(' ').length <= 20
        ) {
          const updatedConv: Thread = {
            ...activeThread,
            title: content,
          }
          updateThread(updatedConv)
          pluginManager
            .get<ConversationalPlugin>(PluginType.Conversational)
            ?.saveThread(updatedConv)
        }
      }, 1000)
    }
  }

  const sendChatMessage = async () => {
    if (!currentPrompt || currentPrompt.trim().length === 0) {
      return
    }
    if (!activeThread) {
      console.error('No active thread')
      return
    }

    if (!activeThread.isFinishInit) {
      if (!selectedModel) {
        alert('Please select a model')
        return
      }
      const assistantId = activeThread.assistants[0].assistant_id ?? ''
      const assistantName = activeThread.assistants[0].assistant_name ?? ''
      const updatedThread: Thread = {
        ...activeThread,
        isFinishInit: true,
        title: `${activeThread.assistants[0].assistant_name} with ${selectedModel.name}`,
        assistants: [
          {
            assistant_id: assistantId,
            assistant_name: assistantName,
            model: {
              id: selectedModel.id,
              settings: selectedModel.settings,
              parameters: selectedModel.parameters,
            },
          },
        ],
      }

      updateThread(updatedThread)

      pluginManager
        .get<ConversationalPlugin>(PluginType.Conversational)
        ?.saveThread(updatedThread)
    }

    updateConvWaiting(activeThread.id, true)

    const prompt = currentPrompt.trim()
    setCurrentPrompt('')

    const messages: ChatCompletionMessage[] = currentMessages
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
    console.debug(`Sending messages: ${JSON.stringify(messages, null, 2)}`)
    const msgId = ulid()
    const messageRequest: MessageRequest = {
      id: msgId,
      threadId: activeThread.id,
      messages,
      parameters: activeThread.assistants[0].model.parameters,
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
    await pluginManager
      .get<ConversationalPlugin>(PluginType.Conversational)
      ?.addNewMessage(threadMessage)

    events.emit(EventName.OnNewMessageRequest, messageRequest)
    updateThreadTitle(messageRequest)
  }

  return {
    sendChatMessage,
  }
}
