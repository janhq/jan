/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, useState } from 'react'

import {
  ConversationalExtension,
  ExtensionTypeEnum,
  MessageStatus,
  ThreadMessage,
} from '@janhq/core'

import { TextArea, Button, Modal, ModalClose } from '@janhq/joi'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'

import { twMerge } from 'tailwind-merge'

import { editPromptAtom } from '@/containers/Providers/Jotai'

import { useActiveModel } from '@/hooks/useActiveModel'

import useSendChatMessage from '@/hooks/useSendChatMessage'

import { extensionManager } from '@/extension'

import {
  editMessageAtom,
  getCurrentChatMessagesAtom,
  setConvoMessagesAtom,
} from '@/helpers/atoms/ChatMessage.atom'
import { spellCheckAtom } from '@/helpers/atoms/Setting.atom'
import {
  activeThreadAtom,
  getActiveThreadIdAtom,
} from '@/helpers/atoms/Thread.atom'

type Props = {
  message: ThreadMessage
}

const EditChatInput: React.FC<Props> = ({ message }) => {
  const activeThread = useAtomValue(activeThreadAtom)
  const { stateModel, stopInference } = useActiveModel()
  const messages = useAtomValue(getCurrentChatMessagesAtom)

  const [editPrompt, setEditPrompt] = useAtom(editPromptAtom)
  const { sendChatMessage } = useSendChatMessage()
  const setMessages = useSetAtom(setConvoMessagesAtom)
  const activeThreadId = useAtomValue(getActiveThreadIdAtom)
  const spellCheck = useAtomValue(spellCheckAtom)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const setEditMessage = useSetAtom(editMessageAtom)
  const [showDialog, setshowDialog] = useState(false)

  const onPromptChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setEditPrompt(e.target.value)
  }

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
    setEditPrompt(message.content[0]?.text?.value)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const sendEditMessage = async () => {
    setEditMessage('')
    const messageIdx = messages.findIndex((msg) => msg.id === message.id)
    const newMessages = messages.slice(0, messageIdx)
    if (activeThread) {
      setMessages(activeThread.id, newMessages)
      await extensionManager
        .get<ConversationalExtension>(ExtensionTypeEnum.Conversational)
        ?.writeMessages(
          activeThread.id,
          // Remove all of the messages below this
          newMessages
        )
        .then(() => {
          sendChatMessage(editPrompt)
        })
    }
  }

  const onKeyDown = async (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (messages[messages.length - 1]?.status !== MessageStatus.Pending)
        sendEditMessage()
      else onStopInferenceClick()
    }
  }

  const onStopInferenceClick = async () => {
    stopInference()
  }

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
          disabled={stateModel.loading || !activeThread}
          value={editPrompt}
          onChange={onPromptChange}
        />
      </div>

      <div className="flex items-center space-x-2">
        <Button
          disabled={
            stateModel.loading ||
            !activeThread ||
            editPrompt.trim().length === 0
          }
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
