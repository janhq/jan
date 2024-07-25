import { useCallback, useEffect, useRef } from 'react'

import { Message, TextContentBlock } from '@janhq/core'
import { TextArea, Button } from '@janhq/joi'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'

import { twMerge } from 'tailwind-merge'

import { editPromptAtom } from '@/containers/Providers/Jotai'

import useMessageUpdateMutation from '@/hooks/useMessageUpdateMutation'

import {
  editMessageAtom,
  updateMessageAtom,
} from '@/helpers/atoms/ChatMessage.atom'
import { spellCheckAtom } from '@/helpers/atoms/Setting.atom'

type Props = {
  message: Message
}

const EditChatInput: React.FC<Props> = ({ message }) => {
  const [editPrompt, setEditPrompt] = useAtom(editPromptAtom)
  const spellCheck = useAtomValue(spellCheckAtom)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const textAreaRef = useRef<HTMLTextAreaElement>(null)
  const setEditMessage = useSetAtom(editMessageAtom)
  const updateMessageState = useSetAtom(updateMessageAtom)
  const updateCortexMessage = useMessageUpdateMutation()

  const onPromptChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setEditPrompt(e.target.value)
    },
    [setEditPrompt]
  )

  useEffect(() => {
    if (textAreaRef.current) {
      textAreaRef.current.focus()
    }
  }, [message.id])

  useEffect(() => {
    if (!textAreaRef.current) return
    textAreaRef.current.style.height = '40px'
    textAreaRef.current.style.height = textAreaRef.current.scrollHeight + 'px'
    textAreaRef.current.style.overflow =
      textAreaRef.current.clientHeight >= 390 ? 'auto' : 'hidden'
  }, [editPrompt])

  useEffect(() => {
    const messageContent = message.content[0]
    if (!messageContent) return
    if (messageContent.type === 'text') {
      const textMessageBlock = messageContent as TextContentBlock
      setEditPrompt(textMessageBlock.text.value)
    }
  }, [setEditPrompt, message])

  const updateMessage = useCallback(() => {
    const updateMessage: TextContentBlock = {
      text: {
        annotations: [],
        value: editPrompt,
      },
      type: 'text',
    }
    updateCortexMessage.mutate({
      threadId: message.thread_id,
      messageId: message.id,
      data: {
        content: [updateMessage],
      },
    })
    updateMessageState(
      message.id,
      message.thread_id,
      [updateMessage],
      message.status
    )
    setEditMessage('')
  }, [
    updateMessageState,
    updateCortexMessage,
    setEditMessage,
    message,
    editPrompt,
  ])

  const onKeyDown = useCallback(
    async (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        updateMessage()
      }
    },
    [updateMessage]
  )

  return (
    <div className="mx-auto flex w-full flex-shrink-0 flex-col items-start justify-center space-y-4 pb-0 pt-1">
      <div className="relative flex w-full flex-col">
        <TextArea
          className={twMerge('max-h-[400px] resize-none pr-20')}
          style={{ height: '40px' }}
          ref={textareaRef}
          spellCheck={spellCheck}
          onKeyDown={onKeyDown}
          placeholder="Enter your message..."
          value={editPrompt}
          onChange={onPromptChange}
        />
      </div>

      <div className="flex items-center space-x-2">
        <Button
          disabled={editPrompt.trim().length === 0}
          onClick={updateMessage}
        >
          Submit
        </Button>
        <Button
          theme="ghost"
          variant="outline"
          onClick={() => setEditMessage('')}
        >
          Cancel
        </Button>
      </div>
    </div>
  )
}

export default EditChatInput
