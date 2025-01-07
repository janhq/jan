import { useCallback } from 'react'

import {
  MessageStatus,
  ExtensionTypeEnum,
  ThreadMessage,
  ChatCompletionRole,
  ConversationalExtension,
  ContentType,
  Thread,
} from '@janhq/core'
import { Tooltip } from '@janhq/joi'
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
import {
  activeThreadAtom,
  isBlockingSendAtom,
  updateThreadAtom,
  updateThreadStateLastMessageAtom,
} from '@/helpers/atoms/Thread.atom'

const MessageToolbar = ({ message }: { message: ThreadMessage }) => {
  const deleteMessage = useSetAtom(deleteMessageAtom)
  const setEditMessage = useSetAtom(editMessageAtom)
  const thread = useAtomValue(activeThreadAtom)
  const messages = useAtomValue(getCurrentChatMessagesAtom)
  const { resendChatMessage } = useSendChatMessage()
  const clipboard = useClipboard({ timeout: 1000 })
  const updateThreadLastMessage = useSetAtom(updateThreadStateLastMessageAtom)
  const updateThread = useSetAtom(updateThreadAtom)
  const isBlockingSend = useAtomValue(isBlockingSendAtom)

  const onDeleteClick = useCallback(async () => {
    deleteMessage(message.id ?? '')

    const lastResponse = messages
      .filter(
        (msg) =>
          msg.id !== message.id && msg.role === ChatCompletionRole.Assistant
      )
      .slice(-1)[0]

    if (thread) {
      // TODO: Should also delete error messages to clear out the error state
      await extensionManager
        .get<ConversationalExtension>(ExtensionTypeEnum.Conversational)
        ?.deleteMessage(thread.id, message.id)
        .catch(console.error)

      const updatedThread: Thread = {
        ...thread,
        metadata: {
          ...thread.metadata,
          lastMessage: messages.filter(
            (msg) => msg.role === ChatCompletionRole.Assistant
          )[
            messages.filter((msg) => msg.role === ChatCompletionRole.Assistant)
              .length - 1
          ]?.content[0]?.text?.value,
        },
      }

      updateThreadLastMessage(thread.id, lastResponse?.content)

      updateThread(updatedThread)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages])

  const onEditClick = async () => {
    setEditMessage(message.id ?? '')
  }

  if (message.status === MessageStatus.Pending) return null

  return (
    <div className="flex flex-row items-center">
      <div className="flex gap-1 bg-[hsla(var(--app-bg))]">
        {message.role === ChatCompletionRole.User &&
          message.content[0]?.type === ContentType.Text &&
          !isBlockingSend && (
            <div
              className="cursor-pointer rounded-lg border border-[hsla(var(--app-border))] p-2"
              onClick={onEditClick}
            >
              <Tooltip
                trigger={
                  <PencilIcon
                    size={14}
                    className="text-[hsla(var(--text-secondary))]"
                  />
                }
                content="Edit"
              />
            </div>
          )}

        {message.id === messages[messages.length - 1]?.id &&
          !messages[messages.length - 1]?.metadata?.error &&
          !messages[messages.length - 1].attachments?.length &&
          !isBlockingSend && (
            <div
              className="cursor-pointer rounded-lg border border-[hsla(var(--app-border))] p-2"
              onClick={resendChatMessage}
            >
              <Tooltip
                trigger={
                  <RefreshCcw
                    size={14}
                    className="text-[hsla(var(--text-secondary))]"
                  />
                }
                content="Regenerate"
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
            <Tooltip
              trigger={
                <CopyIcon
                  size={14}
                  className="text-[hsla(var(--text-secondary))]"
                />
              }
              content="Copy"
            />
          )}
        </div>
        <div
          className="cursor-pointer rounded-lg border border-[hsla(var(--app-border))] p-2"
          onClick={onDeleteClick}
        >
          <Tooltip
            trigger={
              <Trash2Icon
                size={14}
                className="text-[hsla(var(--text-secondary))]"
              />
            }
            content="Delete"
          />
        </div>
      </div>
    </div>
  )
}

export default MessageToolbar
