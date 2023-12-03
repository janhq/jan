import { ChangeEvent, Fragment, KeyboardEvent, useEffect, useRef } from 'react'

import { Button, Textarea } from '@janhq/uikit'

import { useAtom, useAtomValue } from 'jotai'

import { twMerge } from 'tailwind-merge'

import LogoMark from '@/containers/Brand/Logo/Mark'

import { currentPromptAtom } from '@/containers/Providers/Jotai'

import { MainViewState } from '@/constants/screens'

import { useActiveModel } from '@/hooks/useActiveModel'

import { useGetDownloadedModels } from '@/hooks/useGetDownloadedModels'
import { useMainViewState } from '@/hooks/useMainViewState'

import useSendChatMessage from '@/hooks/useSendChatMessage'

import ChatBody from '@/screens/Chat/ChatBody'

import ThreadList from '@/screens/Chat/ThreadList'

import Sidebar, { showRightSideBarAtom } from './Sidebar'

import {
  activeThreadAtom,
  getActiveThreadIdAtom,
  waitingToSendMessage,
} from '@/helpers/atoms/Conversation.atom'

import { activeThreadStateAtom } from '@/helpers/atoms/Conversation.atom'

const ChatScreen = () => {
  const activeThread = useAtomValue(activeThreadAtom)
  const { downloadedModels } = useGetDownloadedModels()

  const { activeModel, stateModel } = useActiveModel()
  const { setMainViewState } = useMainViewState()

  const [currentPrompt, setCurrentPrompt] = useAtom(currentPromptAtom)
  const activeThreadState = useAtomValue(activeThreadStateAtom)
  const { sendChatMessage, queuedMessage } = useSendChatMessage()
  const isWaitingForResponse = activeThreadState?.waitingForResponse ?? false
  const disabled = currentPrompt.trim().length === 0 || isWaitingForResponse

  const activeThreadId = useAtomValue(getActiveThreadIdAtom)
  const [isWaitingToSend, setIsWaitingToSend] = useAtom(waitingToSendMessage)

  const showing = useAtomValue(showRightSideBarAtom)

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const modelRef = useRef(activeModel)

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
    if (textareaRef.current !== null) {
      const scrollHeight = textareaRef.current.scrollHeight
      if (currentPrompt.length === 0) {
        textareaRef.current.style.height = '40px'
      } else {
        textareaRef.current.style.height = `${
          scrollHeight < 40 ? 40 : scrollHeight
        }px`
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPrompt])

  const onKeyDown = async (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter') {
      if (!e.shiftKey) {
        e.preventDefault()
        sendChatMessage()
      }
    }
  }

  console.log(stateModel, 'stateModel')

  return (
    <div className="flex h-full w-full">
      <div className="flex h-full w-60 flex-shrink-0 flex-col overflow-y-auto border-r border-border bg-background dark:bg-background/50">
        <ThreadList />
      </div>
      <div
        className={twMerge(
          'relative flex h-full flex-col bg-background',
          activeThread && activeThreadId && showing
            ? 'w-[calc(100%-560px)]'
            : 'w-full'
        )}
      >
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

          {stateModel.loading && (
            <div className="mb-1 mt-2 py-2 text-center">
              <span className="rounded-lg border border-border px-4 py-2 shadow-lg">
                Starting model {stateModel.model}
              </span>
            </div>
          )}
          {queuedMessage && (
            <div className="my-2 py-2 text-center">
              <span className="rounded-lg border border-border px-4 py-2 shadow-lg">
                Message queued. It can be sent once the model has started
              </span>
            </div>
          )}
          <div className="mx-auto flex w-full flex-shrink-0 items-end justify-center space-x-4 px-8 py-4">
            <Textarea
              className="min-h-10 h-10 max-h-[400px] resize-none pr-20"
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
            <Button
              size="lg"
              disabled={disabled || stateModel.loading || !activeThread}
              themes={'primary'}
              onClick={sendChatMessage}
            >
              Send
            </Button>
          </div>
        </div>
      </div>
      {/* Sidebar */}
      {activeThreadId && activeThread && <Sidebar />}
    </div>
  )
}

export default ChatScreen
