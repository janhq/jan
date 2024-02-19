/* eslint-disable @typescript-eslint/no-explicit-any */
import { useContext, useEffect, useRef, useState } from 'react'

import { InferenceEvent, MessageStatus, events } from '@janhq/core'

import {
  Textarea,
  Button,
  Tooltip,
  TooltipArrow,
  TooltipContent,
  TooltipPortal,
  TooltipTrigger,
} from '@janhq/uikit'
import { useAtom, useAtomValue } from 'jotai'
import {
  FileTextIcon,
  ImageIcon,
  StopCircle,
  PaperclipIcon,
} from 'lucide-react'

import { twMerge } from 'tailwind-merge'

import { currentPromptAtom, fileUploadAtom } from '@/containers/Providers/Jotai'

import { FeatureToggleContext } from '@/context/FeatureToggle'

import { useActiveModel } from '@/hooks/useActiveModel'
import { useClickOutside } from '@/hooks/useClickOutside'

import useSendChatMessage from '@/hooks/useSendChatMessage'

import FileUploadPreview from '../FileUploadPreview'
import ImageUploadPreview from '../ImageUploadPreview'

import { getCurrentChatMessagesAtom } from '@/helpers/atoms/ChatMessage.atom'
import {
  activeThreadAtom,
  getActiveThreadIdAtom,
  isGeneratingResponseAtom,
  threadStatesAtom,
  waitingToSendMessage,
} from '@/helpers/atoms/Thread.atom'

const ChatInput: React.FC = () => {
  const activeThread = useAtomValue(activeThreadAtom)
  const { stateModel } = useActiveModel()
  const messages = useAtomValue(getCurrentChatMessagesAtom)

  const [currentPrompt, setCurrentPrompt] = useAtom(currentPromptAtom)
  const { sendChatMessage } = useSendChatMessage()

  const activeThreadId = useAtomValue(getActiveThreadIdAtom)
  const [isWaitingToSend, setIsWaitingToSend] = useAtom(waitingToSendMessage)
  const [fileUpload, setFileUpload] = useAtom(fileUploadAtom)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const [showAttacmentMenus, setShowAttacmentMenus] = useState(false)
  const { experimentalFeature } = useContext(FeatureToggleContext)
  const isGeneratingResponse = useAtomValue(isGeneratingResponseAtom)
  const threadStates = useAtomValue(threadStatesAtom)

  const isStreamingResponse = Object.values(threadStates).some(
    (threadState) => threadState.waitingForResponse
  )

  const onPromptChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setCurrentPrompt(e.target.value)
  }

  const refAttachmentMenus = useClickOutside(() => setShowAttacmentMenus(false))

  useEffect(() => {
    if (isWaitingToSend && activeThreadId) {
      setIsWaitingToSend(false)
      sendChatMessage(currentPrompt)
    }
  }, [
    activeThreadId,
    isWaitingToSend,
    currentPrompt,
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
  }, [currentPrompt])

  const onKeyDown = async (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (messages[messages.length - 1]?.status !== MessageStatus.Pending)
        sendChatMessage(currentPrompt)
      else onStopInferenceClick()
    }
  }

  const onStopInferenceClick = async () => {
    events.emit(InferenceEvent.OnInferenceStopped, {})
  }

  /**
   * Handles the change event of the extension file input element by setting the file name state.
   * Its to be used to display the extension file name of the selected file.
   * @param event - The change event object.
   */
  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    setFileUpload([{ file: file, type: 'pdf' }])
  }

  const handleImageChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    setFileUpload([{ file: file, type: 'image' }])
  }

  const renderPreview = (fileUpload: any) => {
    if (fileUpload.length > 0) {
      if (fileUpload[0].type === 'image') {
        return <ImageUploadPreview file={fileUpload[0].file} />
      } else {
        return <FileUploadPreview />
      }
    }
  }

  return (
    <div className="mx-auto flex w-full flex-shrink-0 items-end justify-center space-x-4 px-8 py-4">
      <div className="relative flex w-full flex-col">
        {renderPreview(fileUpload)}

        <Textarea
          className={twMerge(
            'max-h-[400px] resize-none pr-20',
            fileUpload.length && 'rounded-t-none'
          )}
          style={{ height: '40px' }}
          ref={textareaRef}
          onKeyDown={onKeyDown}
          placeholder="Enter your message..."
          disabled={stateModel.loading || !activeThread}
          value={currentPrompt}
          onChange={onPromptChange}
        />
        {experimentalFeature && (
          <Tooltip>
            <TooltipTrigger asChild>
              <PaperclipIcon
                size={20}
                className="absolute bottom-2 right-4 cursor-pointer text-muted-foreground"
                onClick={(e) => {
                  if (
                    fileUpload.length > 0 ||
                    (activeThread?.assistants[0].tools &&
                      !activeThread?.assistants[0].tools[0]?.enabled)
                  ) {
                    e.stopPropagation()
                  } else {
                    setShowAttacmentMenus(!showAttacmentMenus)
                  }
                }}
              />
            </TooltipTrigger>
            <TooltipPortal>
              {fileUpload.length > 0 ||
                (activeThread?.assistants[0].tools &&
                  !activeThread?.assistants[0].tools[0]?.enabled && (
                    <TooltipContent side="top" className="max-w-[154px] px-3">
                      {fileUpload.length !== 0 && (
                        <span>
                          Currently, we only support 1 attachment at the same
                          time
                        </span>
                      )}
                      {activeThread?.assistants[0].tools &&
                        activeThread?.assistants[0].tools[0]?.enabled ===
                          false && (
                          <span>
                            Turn on Retrieval in Assistant Settings to use this
                            feature
                          </span>
                        )}
                      <TooltipArrow />
                    </TooltipContent>
                  ))}
            </TooltipPortal>
          </Tooltip>
        )}

        {showAttacmentMenus && (
          <div
            ref={refAttachmentMenus}
            className="absolute bottom-10 right-0 w-36 cursor-pointer rounded-lg border border-border bg-background py-1 shadow"
          >
            <ul>
              <li className="flex w-full cursor-not-allowed  items-center space-x-2 px-4 py-2 text-muted-foreground opacity-50 hover:bg-secondary">
                <ImageIcon size={16} />
                <span className="font-medium">Image</span>
              </li>
              <li
                className="flex w-full cursor-pointer items-center space-x-2 px-4 py-2 text-muted-foreground hover:bg-secondary"
                onClick={() => {
                  fileInputRef.current?.click()
                  setShowAttacmentMenus(false)
                }}
              >
                <FileTextIcon size={16} />
                <span className="font-medium">Document</span>
              </li>
            </ul>
          </div>
        )}
      </div>

      <input
        type="file"
        className="hidden"
        ref={imageInputRef}
        value=""
        onChange={handleImageChange}
        accept="image/png, image/jpeg, image/jpg"
      />
      <input
        type="file"
        className="hidden"
        ref={fileInputRef}
        value=""
        onChange={handleFileChange}
        accept="application/pdf"
      />

      {messages[messages.length - 1]?.status !== MessageStatus.Pending &&
      !isGeneratingResponse &&
      !isStreamingResponse ? (
        <Button
          size="lg"
          disabled={
            stateModel.loading ||
            !activeThread ||
            currentPrompt.trim().length === 0
          }
          themes="primary"
          className="min-w-[100px]"
          onClick={() => sendChatMessage(currentPrompt)}
        >
          Send
        </Button>
      ) : (
        <Button
          size="lg"
          themes="danger"
          onClick={onStopInferenceClick}
          className="min-w-[100px]"
        >
          <StopCircle size={24} />
        </Button>
      )}
    </div>
  )
}

export default ChatInput
