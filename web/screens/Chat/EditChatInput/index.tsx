/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, useState } from 'react'

import {
  ConversationalExtension,
  ExtensionTypeEnum,
  InferenceEvent,
  MessageStatus,
  ThreadMessage,
  events,
} from '@janhq/core'

import {
  Textarea,
  Button,
  Modal,
  ModalClose,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalPortal,
  ModalTitle,
} from '@janhq/uikit'
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
import {
  activeThreadAtom,
  getActiveThreadIdAtom,
  waitingToSendMessage,
} from '@/helpers/atoms/Thread.atom'

type Props = {
  message: ThreadMessage
}

const EditChatInput: React.FC<Props> = ({ message }) => {
  const activeThread = useAtomValue(activeThreadAtom)
  const { stateModel } = useActiveModel()
  const messages = useAtomValue(getCurrentChatMessagesAtom)

  const [editPrompt, setEditPrompt] = useAtom(editPromptAtom)
  const { sendChatMessage } = useSendChatMessage()
  const setMessages = useSetAtom(setConvoMessagesAtom)
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
      sendChatMessage(editPrompt)
    }
  }, [
    activeThreadId,
    isWaitingToSend,
    editPrompt,
    setIsWaitingToSend,
    sendChatMessage,
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
    events.emit(InferenceEvent.OnInferenceStopped, {})
  }

  return (
    <div className="mx-auto flex w-full flex-shrink-0 items-end justify-center space-x-4 pb-0 pt-1">
      <div className="relative flex w-full flex-col">
        <Textarea
          className={twMerge(
            'max-h-[400px] resize-none overflow-y-hidden pr-20'
          )}
          style={{ height: '40px' }}
          ref={textareaRef}
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
          themes="primary"
          onClick={sendEditMessage}
        >
          Submit
        </Button>
        <Button themes="outline" onClick={() => setEditMessage('')}>
          Cancel
        </Button>
      </div>

      <Modal open={showDialog} onOpenChange={() => setshowDialog(false)}>
        <ModalPortal />
        <ModalContent>
          <ModalHeader>
            <ModalTitle>Edit Message</ModalTitle>
          </ModalHeader>
          <p className="text-muted-foreground">
            Do you want to discard the change
          </p>
          <ModalFooter>
            <div className="flex gap-x-2">
              <ModalClose asChild onClick={() => setshowDialog(false)}>
                <Button themes="outline">Cancel</Button>
              </ModalClose>
              <ModalClose asChild onClick={() => setEditMessage('')}>
                <Button autoFocus>Yes</Button>
              </ModalClose>
            </div>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  )
}

export default EditChatInput
