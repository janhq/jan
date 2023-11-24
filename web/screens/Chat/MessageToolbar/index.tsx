import {
  ChatCompletionRole,
  EventName,
  MessageStatus,
  PluginType,
  ThreadMessage,
  events,
} from '@janhq/core'
import { ConversationalPlugin, InferencePlugin } from '@janhq/core/lib/plugins'
import { useAtomValue, useSetAtom } from 'jotai'
import { RefreshCcw, ClipboardCopy, Trash2Icon, StopCircle } from 'lucide-react'

import { toaster } from '@/containers/Toast'

import {
  deleteMessage,
  getCurrentChatMessagesAtom,
} from '@/helpers/atoms/ChatMessage.atom'
import { currentConversationAtom } from '@/helpers/atoms/Conversation.atom'
import { pluginManager } from '@/plugin'

const MessageToolbar = ({ message }: { message: ThreadMessage }) => {
  const deleteAMessage = useSetAtom(deleteMessage)
  const thread = useAtomValue(currentConversationAtom)
  const messages = useAtomValue(getCurrentChatMessagesAtom)
  const stopInference = async () => {
    await pluginManager
      .get<InferencePlugin>(PluginType.Inference)
      ?.stopInference()
    setTimeout(() => {
      events.emit(EventName.OnMessageResponseFinished, message)
    }, 300)
  }
  return (
    <div className="flex flex-row items-center">
      {message.status === MessageStatus.Pending && (
        <StopCircle
          className="mx-1 cursor-pointer rounded-sm bg-gray-800 px-[3px]"
          size={20}
          onClick={() => stopInference()}
        />
      )}
      {message.status !== MessageStatus.Pending &&
        message.id === messages[0]?.id && (
          <RefreshCcw
            className="mx-1 cursor-pointer rounded-sm bg-gray-800 px-[3px]"
            size={20}
            onClick={() => {
              const messageRequest = messages[1]
              if (message.role === ChatCompletionRole.Assistant) {
                deleteAMessage(message.id ?? '')
              }
              events.emit(EventName.OnNewMessageRequest, messageRequest)
            }}
          />
        )}
      <ClipboardCopy
        className="mx-1 cursor-pointer rounded-sm bg-gray-800 px-[3px]"
        size={20}
        onClick={() => {
          navigator.clipboard.writeText(message.content ?? '')
          toaster({
            title: 'Copied to clipboard',
          })
        }}
      />
      <Trash2Icon
        className="mx-1 cursor-pointer rounded-sm bg-gray-800 px-[3px]"
        size={20}
        onClick={async () => {
          deleteAMessage(message.id ?? '')
          if (thread)
            await pluginManager
              .get<ConversationalPlugin>(PluginType.Conversational)
              ?.saveConversation({
                ...thread,
                messages: messages.filter((e) => e.id !== message.id),
              })
        }}
      />
    </div>
  )
}

export default MessageToolbar
