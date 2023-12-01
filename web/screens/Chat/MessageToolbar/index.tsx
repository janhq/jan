import { useMemo } from 'react'

import {
  ChatCompletionRole,
  ChatCompletionMessage,
  EventName,
  MessageRequest,
  MessageStatus,
  ExtensionType,
  ThreadMessage,
  events,
} from '@janhq/core'
import { ConversationalExtension, InferenceExtension } from '@janhq/core'
import { atom, useAtomValue, useSetAtom } from 'jotai'
import { RefreshCcw, ClipboardCopy, Trash2Icon, StopCircle } from 'lucide-react'

import { twMerge } from 'tailwind-merge'

import { toaster } from '@/containers/Toast'

import { extensionManager } from '@/extension'
import {
  deleteMessageAtom,
  getCurrentChatMessagesAtom,
} from '@/helpers/atoms/ChatMessage.atom'
import {
  activeThreadAtom,
  threadStatesAtom,
} from '@/helpers/atoms/Conversation.atom'

const MessageToolbar = ({ message }: { message: ThreadMessage }) => {
  const deleteMessage = useSetAtom(deleteMessageAtom)
  const thread = useAtomValue(activeThreadAtom)
  const messages = useAtomValue(getCurrentChatMessagesAtom)
  const threadStateAtom = useMemo(
    () => atom((get) => get(threadStatesAtom)[thread?.id ?? '']),
    [thread?.id]
  )
  const threadState = useAtomValue(threadStateAtom)

  const stopInference = async () => {
    await extensionManager
      .get<InferenceExtension>(ExtensionType.Inference)
      ?.stopInference()
    setTimeout(() => {
      message.status = MessageStatus.Ready
      events.emit(EventName.OnMessageUpdate, message)
    }, 300)
  }

  return (
    <div
      className={twMerge(
        'flex-row items-center',
        threadState.waitingForResponse ? 'hidden' : 'flex'
      )}
    >
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
          message.id === messages[messages.length - 1]?.id && (
            <div
              className="cursor-pointer border-r border-border px-2 py-2 hover:bg-background/80"
              onClick={() => {
                const messageRequest: MessageRequest = {
                  id: message.id ?? '',
                  messages: messages.slice(0, -1).map((e) => {
                    const msg: ChatCompletionMessage = {
                      role: e.role,
                      content: e.content[0].text.value,
                    }
                    return msg
                  }),
                  threadId: message.thread_id ?? '',
                }
                events.emit(EventName.OnMessageSent, messageRequest)
              }}
            >
              <RefreshCcw size={14} />
            </div>
          )}
        <div
          className="cursor-pointer border-r border-border px-2 py-2 hover:bg-background/80"
          onClick={() => {
            navigator.clipboard.writeText(message.content[0]?.text?.value ?? '')
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
            deleteMessage(message.id ?? '')
            if (thread)
              await extensionManager
                .get<ConversationalExtension>(ExtensionType.Conversational)
                ?.writeMessages(
                  thread.id,
                  messages.filter((msg) => msg.id !== message.id)
                )
          }}
        >
          <Trash2Icon size={14} />
        </div>
      </div>
    </div>
  )
}

export default MessageToolbar
