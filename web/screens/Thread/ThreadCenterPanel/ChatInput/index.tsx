import { useEffect, useRef, useState } from 'react'

import { TextArea, Button, useMediaQuery } from '@janhq/joi'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import {
  StopCircle,
  SettingsIcon,
  ChevronUpIcon,
  Settings2Icon,
} from 'lucide-react'

import { twMerge } from 'tailwind-merge'

import SendIcon from '@/components/SendIcon'

import ModelDropdown from '@/containers/ModelDropdown'
import { currentPromptAtom } from '@/containers/Providers/Jotai'

import { showRightPanelAtom } from '@/helpers/atoms/App.atom'
import { getCurrentChatMessagesAtom } from '@/helpers/atoms/ChatMessage.atom'
import { spellCheckAtom } from '@/helpers/atoms/Setting.atom'
import {
  activeThreadAtom,
  getActiveThreadIdAtom,
  isGeneratingResponseAtom,
  waitingToSendMessage,
} from '@/helpers/atoms/Thread.atom'
import { activeTabThreadRightPanelAtom } from '@/helpers/atoms/ThreadRightPanel.atom'

type Props = {
  sendMessage: (message: string) => void
  stopInference: () => void
}

const ChatInput: React.FC<Props> = ({ sendMessage, stopInference }) => {
  const activeThread = useAtomValue(activeThreadAtom)
  const messages = useAtomValue(getCurrentChatMessagesAtom)
  const [activeSetting, setActiveSetting] = useState(false)
  const spellCheck = useAtomValue(spellCheckAtom)

  const [currentPrompt, setCurrentPrompt] = useAtom(currentPromptAtom)

  const activeThreadId = useAtomValue(getActiveThreadIdAtom)
  const [isWaitingToSend, setIsWaitingToSend] = useAtom(waitingToSendMessage)
  // const [fileUpload, setFileUpload] = useAtom(fileUploadAtom)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const isGeneratingResponse = useAtomValue(isGeneratingResponseAtom)

  const setActiveTabThreadRightPanel = useSetAtom(activeTabThreadRightPanelAtom)

  const onPromptChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setCurrentPrompt(e.target.value)
  }

  const [showRightPanel, setShowRightPanel] = useAtom(showRightPanelAtom)

  const matches = useMediaQuery('(max-width: 880px)')

  useEffect(() => {
    if (isWaitingToSend && activeThreadId) {
      setIsWaitingToSend(false)
      sendMessage(currentPrompt)
    }
  }, [
    activeThreadId,
    isWaitingToSend,
    currentPrompt,
    setIsWaitingToSend,
    sendMessage,
  ])

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.focus()
    }
  }, [activeThreadId])

  useEffect(() => {
    if (textareaRef.current?.clientHeight) {
      textareaRef.current.style.height = activeSetting ? '100px' : '40px'
      textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px'
      textareaRef.current.style.overflow =
        textareaRef.current.clientHeight >= 390 ? 'auto' : 'hidden'
    }
  }, [textareaRef.current?.clientHeight, currentPrompt, activeSetting])

  const onKeyDown = async (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      if (isGeneratingResponse) return
      if (messages[messages.length - 1]?.status !== 'in_progress')
        sendMessage(currentPrompt)
      else stopInference()
    }
  }

  /**
   * Handles the change event of the extension file input element by setting the file name state.
   * Its to be used to display the extension file name of the selected file.
   * @param event - The change event object.
   */
  // const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
  //   const file = event.target.files?.[0]
  //   if (!file) return
  //   setFileUpload([{ file: file, type: 'pdf' }])
  // }

  // const handleImageChange = (event: React.ChangeEvent<HTMLInputElement>) => {
  //   const file = event.target.files?.[0]
  //   if (!file) return
  //   setFileUpload([{ file: file, type: 'image' }])
  // }

  // const renderPreview = (fileUpload: any) => {
  //   if (fileUpload.length > 0) {
  //     if (fileUpload[0].type === 'image') {
  //       return <ImageUploadPreview file={fileUpload[0].file} />
  //     } else {
  //       return <FileUploadPreview />
  //     }
  //   }
  // }

  return (
    <div className="relative p-4 pb-2">
      <div className="relative flex w-full flex-col">
        {/* {renderPreview(fileUpload)} */}
        <TextArea
          className={twMerge(
            'relative max-h-[400px] resize-none  pr-20',
            // fileUpload.length && 'rounded-t-none',
            activeSetting && 'pb-14 pr-16'
          )}
          spellCheck={spellCheck}
          data-testid="txt-input-chat"
          style={{ height: activeSetting ? '100px' : '40px' }}
          ref={textareaRef}
          onKeyDown={onKeyDown}
          placeholder="Ask me anything"
          disabled={!activeThread}
          value={currentPrompt}
          onChange={onPromptChange}
        />
        {/* {experimentalFeature && (
          <Tooltip
            trigger={
              <Button
                theme="icon"
                className="absolute left-3 top-2.5"
                onClick={(e) => {
                  if (
                    fileUpload.length > 0 ||
                    (activeThread?.assistants[0].tools &&
                      !activeThread?.assistants[0].tools[0]?.enabled &&
                      !isVisionModel)
                  ) {
                    e.stopPropagation()
                  } else {
                    setShowAttacmentMenus(!showAttacmentMenus)
                  }
                }}
              >
                <PaperclipIcon
                  size={18}
                  className="text-[hsla(var(--text-secondary))]"
                />
              </Button>
            }
            disabled={
              activeThread?.assistants[0].tools &&
              activeThread?.assistants[0].tools[0]?.enabled
            }
            content={
              <>
                {fileUpload.length > 0 ||
                  (activeThread?.assistants[0].tools &&
                    !activeThread?.assistants[0].tools[0]?.enabled &&
                    !isVisionModel && (
                      <>
                        {fileUpload.length !== 0 && (
                          <span>
                            Currently, we only support 1 attachment at the same
                            time.
                          </span>
                        )}
                        {activeThread?.assistants[0].tools &&
                          activeThread?.assistants[0].tools[0]?.enabled ===
                            false && (
                            <span>
                              Turn on Retrieval in Assistant Settings to use
                              this feature.
                            </span>
                          )}
                      </>
                    ))}
              </>
            }
          />
        )} */}

        <div className={twMerge('absolute right-3 top-1.5')}>
          <div className="flex items-center gap-x-4">
            {!activeSetting && (
              <div className="flex h-8 items-center">
                <Button
                  theme="icon"
                  onClick={() => {
                    setActiveSetting(!activeSetting)
                  }}
                >
                  <SettingsIcon
                    size={18}
                    className="text-[hsla(var(--text-secondary))]"
                  />
                </Button>
              </div>
            )}
            {messages[messages.length - 1]?.status !== 'in_progress' &&
            isGeneratingResponse ? (
              <Button
                theme="destructive"
                onClick={stopInference}
                className="h-8 w-8 rounded-lg p-0"
              >
                <StopCircle size={20} />
              </Button>
            ) : (
              <>
                {currentPrompt.length !== 0 && (
                  <Button
                    disabled={
                      !activeThread || currentPrompt.trim().length === 0
                    }
                    className="h-8 w-8 rounded-lg p-0"
                    data-testid="btn-send-chat"
                    onClick={() => sendMessage(currentPrompt)}
                  >
                    <SendIcon />
                  </Button>
                )}
              </>
            )}
          </div>
        </div>

        {activeSetting && (
          <div
            className={twMerge(
              'absolute bottom-[6px] left-[1px] flex w-[calc(100%-2px)] items-center justify-between rounded-lg bg-[hsla(var(--textarea-bg))] p-3',
              !activeThread && 'bg-transparent'
            )}
          >
            <div className="flex items-center gap-x-3">
              <ModelDropdown chatInputMode />
              <Button
                theme="icon"
                onClick={() => {
                  setActiveTabThreadRightPanel('model')
                  if (matches) {
                    setShowRightPanel(!showRightPanel)
                  } else if (!showRightPanel) {
                    setShowRightPanel(true)
                  }
                }}
              >
                <Settings2Icon
                  size={16}
                  className="flex-shrink-0 cursor-pointer text-[hsla(var(--text-secondary))]"
                />
              </Button>
              {/* {experimentalFeature && (
                <Badge
                  className="flex cursor-pointer items-center gap-x-1"
                  theme="secondary"
                  onClick={() => {
                    setActiveTabThreadRightPanel('tools')
                    if (matches) {
                      setShowRightPanel(!showRightPanel)
                    } else if (!showRightPanel) {
                      setShowRightPanel(true)
                    }
                  }}
                >
                  <ShapesIcon
                    size={16}
                    className="flex-shrink-0 text-[hsla(var(--text-secondary))]"
                  />
                  <span>Tools</span>
                </Badge>
              )} */}
            </div>
            <Button theme="icon" onClick={() => setActiveSetting(false)}>
              <ChevronUpIcon
                size={16}
                className="cursor-pointer text-[hsla(var(--text-secondary))]"
              />
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

export default ChatInput
