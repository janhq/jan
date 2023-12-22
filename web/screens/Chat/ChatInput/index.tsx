import { useEffect, useRef } from 'react'

import { EventName, MessageStatus, events } from '@janhq/core'

import { Textarea, Button } from '@janhq/uikit'
import { useAtom, useAtomValue } from 'jotai'
import { FolderIcon, ImageIcon, StopCircle } from 'lucide-react'

import { currentPromptAtom, fileUploadAtom } from '@/containers/Providers/Jotai'

import { useActiveModel } from '@/hooks/useActiveModel'

import { useGetDownloadedModels } from '@/hooks/useGetDownloadedModels'
import useSendChatMessage from '@/hooks/useSendChatMessage'

import ImageUploadPreview from '../ImageUploadPreview'

import { getCurrentChatMessagesAtom } from '@/helpers/atoms/ChatMessage.atom'
import {
  activeThreadAtom,
  activeThreadStateAtom,
  getActiveThreadIdAtom,
  waitingToSendMessage,
} from '@/helpers/atoms/Thread.atom'

const ChatInput: React.FC = () => {
  const activeThread = useAtomValue(activeThreadAtom)
  const { stateModel } = useActiveModel()
  const messages = useAtomValue(getCurrentChatMessagesAtom)

  const [currentPrompt, setCurrentPrompt] = useAtom(currentPromptAtom)
  const activeThreadState = useAtomValue(activeThreadStateAtom)
  const { sendChatMessage } = useSendChatMessage()
  const isWaitingForResponse = activeThreadState?.waitingForResponse ?? false
  const disabled = currentPrompt.trim().length === 0 || isWaitingForResponse

  const activeThreadId = useAtomValue(getActiveThreadIdAtom)
  const [isWaitingToSend, setIsWaitingToSend] = useAtom(waitingToSendMessage)
  const [fileUpload, setFileUpload] = useAtom(fileUploadAtom)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)

  const { downloadedModels } = useGetDownloadedModels()
  const currentModel = downloadedModels.find(
    (model) => model.id === activeThread?.assistants[0].model.id
  )
  const isVisionModel = currentModel?.metadata.tags.includes('Vision')

  const onPromptChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setCurrentPrompt(e.target.value)
  }

  useEffect(() => {
    if (isWaitingToSend && activeThreadId) {
      setIsWaitingToSend(false)
      sendChatMessage()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waitingToSendMessage, activeThreadId])

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = '40px'
      textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px'
    }
  }, [currentPrompt])

  const onKeyDown = async (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter') {
      if (!e.shiftKey) {
        e.preventDefault()
        if (messages[messages.length - 1]?.status !== MessageStatus.Pending)
          sendChatMessage()
        else onStopInferenceClick()
      }
    }
  }

  const onStopInferenceClick = async () => {
    events.emit(EventName.OnInferenceStopped, {})
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
        // return <ImageUploadPreview file={fileUpload[0].file} />
        return <div> PDF </div>
      }
    }
  }

  return (
    <div className="mx-auto flex w-full flex-shrink-0 items-end justify-center space-x-4 px-8 py-4">
      <div className="flex flex-col">
        {renderPreview(fileUpload)}
        <Textarea
          className="max-h-[400px] resize-none overflow-y-hidden pr-20"
          style={{ height: '40px' }}
          ref={textareaRef}
          onKeyDown={onKeyDown}
          placeholder="Enter your message..."
          disabled={stateModel.loading || !activeThread}
          value={currentPrompt}
          onChange={onPromptChange}
        />
      </div>
      <input
        type="file"
        style={{ display: 'none' }}
        ref={imageInputRef}
        onChange={handleImageChange}
        accept="image/png, image/jpeg, image/jpg"
      />
      <input
        type="file"
        style={{ display: 'none' }}
        ref={fileInputRef}
        onChange={handleFileChange}
        accept="application/pdf"
      />
      {/* {isVisionModel ? */}
      <Button onClick={() => imageInputRef.current?.click()}>
        <ImageIcon className="h-6 w-6" />
      </Button>
      {/* : null */}
      {/* } */}
      <Button onClick={() => fileInputRef.current?.click()}>
        <FolderIcon className="h-6 w-6" />
      </Button>
      {messages[messages.length - 1]?.status !== MessageStatus.Pending ? (
        <Button
          size="lg"
          // disabled={disabled || stateModel.loading || !activeThread}
          themes="primary"
          className="min-w-[100px]"
          onClick={sendChatMessage}
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
