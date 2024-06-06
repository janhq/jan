import { useCallback, useMemo } from 'react'

import { Message, TextContentBlock } from '@janhq/core'
import { Tooltip } from '@janhq/joi'
import { useSetAtom } from 'jotai'
import {
  CopyIcon,
  Trash2Icon,
  CheckIcon,
  PencilIcon,
  RefreshCcw,
} from 'lucide-react'

import { useClipboard } from '@/hooks/useClipboard'
import useCortex from '@/hooks/useCortex'

import useSendMessage from '@/hooks/useSendMessage'

import {
  deleteMessageAtom,
  editMessageAtom,
} from '@/helpers/atoms/ChatMessage.atom'

type Props = {
  isLastMessage: boolean
  message: Message
}

const MessageToolbar: React.FC<Props> = ({ isLastMessage, message }) => {
  const deleteMessage = useSetAtom(deleteMessageAtom)
  const setEditMessage = useSetAtom(editMessageAtom)
  const { resendMessage } = useSendMessage()
  const clipboard = useClipboard({ timeout: 1000 })
  const { deleteMessage: deleteCortexMessage } = useCortex()

  const onDeleteClick = useCallback(
    async (threadId: string, messageId: string) => {
      await deleteCortexMessage(threadId, messageId)
      deleteMessage(messageId)
    },
    [deleteMessage, deleteCortexMessage]
  )

  const onCopyClick = useCallback(() => {
    const messageContent = message.content[0]
    if (!messageContent) return
    if (messageContent.type === 'text') {
      const textContentBlock = messageContent as TextContentBlock
      clipboard.copy(textContentBlock.text.value)
    }
  }, [clipboard, message])

  const onRegenerateClick = useCallback(async () => {
    // current message must be from assistant
    if (message.role !== 'assistant') return
    await deleteCortexMessage(message.thread_id, message.id)
    deleteMessage(message.id)
    await resendMessage()
  }, [deleteCortexMessage, deleteMessage, resendMessage, message])

  const allowRegenerate = useMemo(
    () => isLastMessage && message.role === 'assistant',
    [isLastMessage, message]
  )

  const allowEditMessage = useMemo(
    () => message.role === 'user' && message.content[0]?.type === 'text',
    [message]
  )

  if (message.status === 'in_progress') return null

  return (
    <div className="flex flex-row items-center">
      <div className="flex gap-1 bg-[hsla(var(--app-bg))]">
        {allowEditMessage && (
          <div
            className="cursor-pointer rounded-lg border border-[hsla(var(--app-border))] p-2"
            onClick={() => setEditMessage(message.id)}
          >
            <PencilIcon
              size={14}
              className="text-[hsla(var(--text-secondary))]"
            />
          </div>
        )}

        {allowRegenerate && (
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
          onClick={onCopyClick}
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
          onClick={() => onDeleteClick(message.thread_id, message.id)}
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
