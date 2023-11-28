import {
  ChatCompletionRole,
  ChatCompletionMessage,
  EventName,
  MessageRequest,
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
      <div className="flex overflow-hidden rounded-md border border-border bg-background/20">
        {message.status === MessageStatus.Pending && (
          <div
            className="cursor-pointer border-r border-border px-2 py-2 hover:bg-background/80"
            onClick={() => stopInference()}
          >
            <StopCircle size={14} />
          </div>
        )}
        {message.status !== MessageStatus.Pending &&
          message.id === messages[0]?.id && (
            <div
              className="cursor-pointer border-r border-border px-2 py-2 hover:bg-background/80"
              onClick={() => {
                const messageRequest: MessageRequest = {
                  id: message.id ?? '',
                  messages: messages
                    .slice(1, messages.length)
                    .reverse()
                    .map((e) => {
                      return {
                        content: e.content,
                        role: e.role,
                      } as ChatCompletionMessage
                    }),
                  threadId: message.threadId ?? '',
                }
                if (message.role === ChatCompletionRole.Assistant) {
                  deleteAMessage(message.id ?? '')
                }
                events.emit(EventName.OnNewMessageRequest, messageRequest)
              }}
            >
              <RefreshCcw size={14} />
            </div>
          )}
        <div
          className="cursor-pointer border-r border-border px-2 py-2 hover:bg-background/80"
          onClick={() => {
            navigator.clipboard.writeText(message.content ?? '')
            toaster({
              title: 'Copied to clipboard',
            })
          }}
        >
          <ClipboardCopy size={14} />
        </div>
        <div
          className="cursor-pointer px-2 py-2 hover:bg-background/80"
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
        >
          <Trash2Icon size={14} />
        </div>
      </div>
    </div>
  )
}

export default MessageToolbar
