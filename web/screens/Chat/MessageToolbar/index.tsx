import {
  MessageStatus,
  ExtensionTypeEnum,
  ThreadMessage,
  ChatCompletionRole,
  ConversationalExtension,
  ContentType,
} from '@janhq/core'
import { useAtomValue, useSetAtom } from 'jotai'
import {
  RefreshCcw,
  CopyIcon,
  Trash2Icon,
  CheckIcon,
  PencilIcon,
} from 'lucide-react'

import { useClipboard } from '@/hooks/useClipboard'
import useSendChatMessage from '@/hooks/useSendChatMessage'

import { extensionManager } from '@/extension'
import {
  deleteMessageAtom,
  editMessageAtom,
  getCurrentChatMessagesAtom,
} from '@/helpers/atoms/ChatMessage.atom'
import { activeThreadAtom } from '@/helpers/atoms/Thread.atom'

const MessageToolbar = ({ message }: { message: ThreadMessage }) => {
  const deleteMessage = useSetAtom(deleteMessageAtom)
  const setEditMessage = useSetAtom(editMessageAtom)
  const thread = useAtomValue(activeThreadAtom)
  const messages = useAtomValue(getCurrentChatMessagesAtom)
  const { resendChatMessage } = useSendChatMessage()
  const clipboard = useClipboard({ timeout: 1000 })

  const onDeleteClick = async () => {
    deleteMessage(message.id ?? '')
    if (thread) {
      // Should also delete error messages to clear out the error state
      await extensionManager
        .get<ConversationalExtension>(ExtensionTypeEnum.Conversational)
        ?.writeMessages(
          thread.id,
          messages.filter(
            (msg) => msg.id !== message.id && msg.status !== MessageStatus.Error
          )
        )
    }
  }

  const onEditClick = async () => {
    setEditMessage(message.id ?? '')
  }

  const onRegenerateClick = async () => {
    resendChatMessage(message)
  }

  if (message.status === MessageStatus.Pending) return null

  return (
    <div className="flex flex-row items-center">
      <div className="flex gap-1 bg-[hsla(var(--app-bg))]">
        {message.role === ChatCompletionRole.User &&
          message.content[0]?.type === ContentType.Text && (
            <div
              className="cursor-pointer rounded-lg border border-[hsla(var(--app-border))] p-2"
              onClick={onEditClick}
            >
              <PencilIcon
                size={14}
                className="text-[hsla(var(--text-secondary))]"
              />
            </div>
          )}

        {message.id === messages[messages.length - 1]?.id &&
          messages[messages.length - 1].status !== MessageStatus.Error &&
          messages[messages.length - 1].content[0]?.type !==
            ContentType.Pdf && (
            <div
              className="cursor-pointer rounded-lg border border-[hsla(var(--app-border))] p-2"
              onClick={onRegenerateClick}
            >
              <RefreshCcw
                size={14}
                className="text-[hsla(var(--text-secondary))]"
              />
            </div>
          )}

        <div
          className="cursor-pointer rounded-lg border border-[hsla(var(--app-border))] p-2"
          onClick={() => {
            clipboard.copy(message.content[0]?.text?.value ?? '')
          }}
        >
          {clipboard.copied ? (
            <CheckIcon size={14} className="text-[hsla(var(--success-bg))]" />
          ) : (
            <CopyIcon
              size={14}
              className="text-[hsla(var(--text-secondary))]"
            />
          )}
        </div>
        <div
          className="cursor-pointer rounded-lg border border-[hsla(var(--app-border))] p-2"
          onClick={onDeleteClick}
        >
          <Trash2Icon
            size={14}
            className="text-[hsla(var(--text-secondary))]"
          />
        </div>
      </div>
    </div>
  )
}

export default MessageToolbar
