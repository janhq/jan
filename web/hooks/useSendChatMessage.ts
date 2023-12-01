import {
  ChatCompletionMessage,
  ChatCompletionRole,
  ContentType,
  EventName,
  MessageRequest,
  MessageStatus,
  ExtensionType,
  Thread,
  ThreadMessage,
  events,
} from '@janhq/core'
import { ConversationalExtension, InferenceExtension } from '@janhq/core'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'

import { ulid } from 'ulid'

import { selectedModelAtom } from '@/containers/DropdownListSidebar'
import { currentPromptAtom } from '@/containers/Providers/Jotai'

import { toaster } from '@/containers/Toast'

import { useActiveModel } from './useActiveModel'

import { extensionManager } from '@/extension/ExtensionManager'
import {
  addNewMessageAtom,
  getCurrentChatMessagesAtom,
} from '@/helpers/atoms/ChatMessage.atom'
import {
  activeThreadAtom,
  updateThreadAtom,
  updateThreadWaitingForResponseAtom,
} from '@/helpers/atoms/Conversation.atom'

export default function useSendChatMessage() {
  const activeThread = useAtomValue(activeThreadAtom)
  const addNewMessage = useSetAtom(addNewMessageAtom)
  const updateThread = useSetAtom(updateThreadAtom)
  const updateThreadWaiting = useSetAtom(updateThreadWaitingForResponseAtom)
  const [currentPrompt, setCurrentPrompt] = useAtom(currentPromptAtom)

  const currentMessages = useAtomValue(getCurrentChatMessagesAtom)
  const { activeModel } = useActiveModel()
  const selectedModel = useAtomValue(selectedModelAtom)
  const { startModel } = useActiveModel()

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
        const result = await extensionManager
          .get<InferenceExtension>(ExtensionType.Inference)
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
          extensionManager
            .get<ConversationalExtension>(ExtensionType.Conversational)
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
        toaster({ title: 'Please select a model' })
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

      extensionManager
        .get<ConversationalExtension>(ExtensionType.Conversational)
        ?.saveThread(updatedThread)
    }

    updateThreadWaiting(activeThread.id, true)

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
    updateThreadTitle(messageRequest)

    await extensionManager
      .get<ConversationalExtension>(ExtensionType.Conversational)
      ?.addNewMessage(threadMessage)

    const modelId = selectedModel?.id ?? activeThread.assistants[0].model.id
    if (activeModel?.id !== modelId) {
      await startModel(modelId)
    }
    events.emit(EventName.OnMessageSent, messageRequest)
  }

  return {
    sendChatMessage,
  }
}
