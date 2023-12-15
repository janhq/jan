import { ChangeEvent, Fragment, KeyboardEvent, useEffect, useRef } from 'react'

import { FolderIcon } from '@heroicons/react/24/solid'
import { EventName, MessageStatus, events } from '@janhq/core'
import { Button, Textarea } from '@janhq/uikit'

import { useAtom, useAtomValue, useSetAtom } from 'jotai'

import { debounce } from 'lodash'
import { StopCircle } from 'lucide-react'

import LogoMark from '@/containers/Brand/Logo/Mark'

import ModelReload from '@/containers/Loader/ModelReload'
import ModelStart from '@/containers/Loader/ModelStart'
import {
  currentFileAtom,
  currentPromptAtom,
} from '@/containers/Providers/Jotai'

import { showLeftSideBarAtom } from '@/containers/Providers/KeyListener'

import { MainViewState } from '@/constants/screens'

import { useActiveModel } from '@/hooks/useActiveModel'

import { useGetDownloadedModels } from '@/hooks/useGetDownloadedModels'
import { useMainViewState } from '@/hooks/useMainViewState'

import useSendChatMessage from '@/hooks/useSendChatMessage'

import ChatBody from '@/screens/Chat/ChatBody'

import ThreadList from '@/screens/Chat/ThreadList'

import Sidebar from './Sidebar'

import { getCurrentChatMessagesAtom } from '@/helpers/atoms/ChatMessage.atom'

import {
  activeThreadAtom,
  engineParamsUpdateAtom,
  getActiveThreadIdAtom,
  waitingToSendMessage,
} from '@/helpers/atoms/Thread.atom'

import { activeThreadStateAtom } from '@/helpers/atoms/Thread.atom'

const ChatScreen = () => {
  const activeThread = useAtomValue(activeThreadAtom)
  const { downloadedModels } = useGetDownloadedModels()
  const showLeftSideBar = useAtomValue(showLeftSideBarAtom)

  const { activeModel, stateModel } = useActiveModel()
  const { setMainViewState } = useMainViewState()
  const messages = useAtomValue(getCurrentChatMessagesAtom)

  const [currentPrompt, setCurrentPrompt] = useAtom(currentPromptAtom)
  const activeThreadState = useAtomValue(activeThreadStateAtom)
  const { sendChatMessage, queuedMessage, reloadModel } = useSendChatMessage()
  const isWaitingForResponse = activeThreadState?.waitingForResponse ?? false
  const isDisabledChatbox =
    currentPrompt.trim().length === 0 || isWaitingForResponse

  const activeThreadId = useAtomValue(getActiveThreadIdAtom)
  const [isWaitingToSend, setIsWaitingToSend] = useAtom(waitingToSendMessage)
  const setUploadedFile = useSetAtom(currentFileAtom)

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const modelRef = useRef(activeModel)
  const engineParamsUpdate = useAtomValue(engineParamsUpdateAtom)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    modelRef.current = activeModel
  }, [activeModel])

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

  const onKeyDown = debounce(
    async (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter') {
        if (!e.shiftKey) {
          e.preventDefault()
          if (messages[messages.length - 1]?.status !== MessageStatus.Pending)
            sendChatMessage()
          else onStopInferenceClick()
        }
      }
    },
    50,
    { leading: false, trailing: true }
  )

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
    if (file) setUploadedFile(file)
  }

  return (
    <div className="flex h-full w-full">
      {/* Left side bar */}
      {showLeftSideBar ? (
        <div className="flex h-full w-60 flex-shrink-0 flex-col overflow-y-auto border-r border-border">
          <ThreadList />
        </div>
      ) : null}

      <div className="relative flex h-full w-full flex-col overflow-auto bg-background">
        <div className="flex h-full w-full flex-col justify-between">
          {activeThread ? (
            <div className="flex h-full w-full overflow-y-auto overflow-x-hidden">
              <ChatBody />
            </div>
          ) : (
            <div className="mx-auto mt-8 flex h-full w-3/4 flex-col items-center justify-center text-center">
              {downloadedModels.length === 0 && (
                <Fragment>
                  <LogoMark
                    className="mx-auto mb-4 animate-wave"
                    width={56}
                    height={56}
                  />
                  <h1 className="text-2xl font-bold">Welcome!</h1>
                  <p className="mt-1 text-base">
                    You need to download your first model
                  </p>
                  <Button
                    className="mt-4"
                    onClick={() => setMainViewState(MainViewState.Hub)}
                  >
                    Explore The Hub
                  </Button>
                </Fragment>
              )}
            </div>
          )}

          {!engineParamsUpdate && <ModelStart />}

          {reloadModel && (
            <>
              <ModelReload />
              <div className="mb-2 text-center">
                <span className="text-muted-foreground">
                  Model is reloading to apply new changes.
                </span>
              </div>
            </>
          )}

          {queuedMessage && !reloadModel && (
            <div className="mb-2 text-center">
              <span className="text-muted-foreground">
                Message queued. It can be sent once the model has started
              </span>
            </div>
          )}

          <div className="mx-auto flex w-full flex-shrink-0 items-end justify-center space-x-4 px-8 py-4">
            <Textarea
              className="max-h-[400px] resize-none overflow-y-auto pr-20"
              style={{ height: '40px' }}
              ref={textareaRef}
              onKeyDown={(e: KeyboardEvent<HTMLTextAreaElement>) =>
                onKeyDown(e)
              }
              placeholder="Enter your message..."
              disabled={stateModel.loading || !activeThread}
              value={currentPrompt}
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
                onPromptChange(e)
              }
            />
            {/* {activeModel?.visionModel && ( */}
            <input
              type="file"
              style={{ display: 'none' }}
              ref={fileInputRef}
              onChange={handleFileChange}
            />
            <Button onClick={() => fileInputRef.current?.click()}>
              <FolderIcon className="h-6 w-6" />
            </Button>
            {/* )} */}
            {messages[messages.length - 1]?.status !== MessageStatus.Pending ? (
              <Button
                size="lg"
                disabled={
                  isDisabledChatbox || stateModel.loading || !activeThread
                }
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
        </div>
      </div>

      {/* Right side bar */}
      {activeThread && <Sidebar />}
    </div>
  )
}

export default ChatScreen
