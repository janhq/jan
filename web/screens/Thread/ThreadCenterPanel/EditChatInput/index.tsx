import { useEffect, useRef, useState } from 'react'

import { Message, TextContentBlock } from '@janhq/core'
import { TextArea, Button, Modal, ModalClose } from '@janhq/joi'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'

import { twMerge } from 'tailwind-merge'

import { editPromptAtom } from '@/containers/Providers/Jotai'

import useSendMessage from '@/hooks/useSendMessage'

import {
  editMessageAtom,
  getCurrentChatMessagesAtom,
} from '@/helpers/atoms/ChatMessage.atom'
import {
  activeThreadAtom,
  getActiveThreadIdAtom,
  waitingToSendMessage,
} from '@/helpers/atoms/Thread.atom'

type Props = {
  message: Message
}

const EditChatInput: React.FC<Props> = ({ message }) => {
  const activeThread = useAtomValue(activeThreadAtom)
  const messages = useAtomValue(getCurrentChatMessagesAtom)

  const [editPrompt, setEditPrompt] = useAtom(editPromptAtom)
  const { sendMessage } = useSendMessage()
  const activeThreadId = useAtomValue(getActiveThreadIdAtom)

  const [isWaitingToSend, setIsWaitingToSend] = useAtom(waitingToSendMessage)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const setEditMessage = useSetAtom(editMessageAtom)
  const [showDialog, setshowDialog] = useState(false)

  const onPromptChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setEditPrompt(e.target.value)
  }

  useEffect(() => {
    if (isWaitingToSend && activeThreadId) {
      setIsWaitingToSend(false)
      sendMessage(editPrompt)
    }
  }, [
    activeThreadId,
    isWaitingToSend,
    editPrompt,
    setIsWaitingToSend,
    sendMessage,
  ])

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.focus()
    }
  }, [activeThreadId])

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = '40px'
      textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px'
      textareaRef.current.style.overflow =
        textareaRef.current.clientHeight >= 390 ? 'auto' : 'hidden'
    }
  }, [editPrompt])

  useEffect(() => {
    const messageContent = message.content[0]
    if (!messageContent) return
    if (messageContent.type === 'text') {
      const textMessageBlock = messageContent as TextContentBlock
      setEditPrompt(textMessageBlock.text.value)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const sendEditMessage = async () => {
    setEditMessage('')
    const messageIdx = messages.findIndex((msg) => msg.id === message.id)
    const newMessages = messages.slice(0, messageIdx)
    if (activeThread) {
      // setMessages(activeThread.id, newMessages)
      // await extensionManager
      //   .get<ConversationalExtension>(ExtensionTypeEnum.Conversational)
      //   ?.writeMessages(
      //     activeThread.id,
      //     // Remove all of the messages below this
      //     newMessages
      //   )
      //   .then(() => {
      //     sendChatMessage(editPrompt)
      //   })
    }
  }

  const onKeyDown = async (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (messages[messages.length - 1]?.status !== 'in_progress') {
        sendEditMessage()
      }
      // else stopInference()
    }
  }

  return (
    <div className="mx-auto flex w-full flex-shrink-0 flex-col items-start justify-center space-y-4 pb-0 pt-1">
      <div className="relative flex w-full flex-col">
        <TextArea
          className={twMerge('max-h-[400px] resize-none pr-20')}
          style={{ height: '40px' }}
          ref={textareaRef}
          onKeyDown={onKeyDown}
          placeholder="Enter your message..."
          disabled={!activeThread}
          value={editPrompt}
          onChange={onPromptChange}
        />
      </div>

      <div className="flex items-center space-x-2">
        <Button
          disabled={!activeThread || editPrompt.trim().length === 0}
          onClick={sendEditMessage}
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

      <Modal
        open={showDialog}
        onOpenChange={() => setshowDialog(false)}
        title="Edit Message"
        content={
          <div>
            <p className="text-[hsla(var(--text-secondary)]">
              Do you want to discard the change
            </p>
            <div className="mt-4 flex justify-end gap-x-2">
              <ModalClose asChild onClick={() => setshowDialog(false)}>
                <Button theme="ghost">Cancel</Button>
              </ModalClose>
              <ModalClose asChild onClick={() => setEditMessage('')}>
                <Button autoFocus>Yes</Button>
              </ModalClose>
            </div>
          </div>
        }
      />
    </div>
  )
}

export default EditChatInput
