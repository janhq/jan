import { Fragment, useEffect, useRef, useState } from 'react'

import { Button, Badge, Textarea } from '@janhq/uikit'

import { useAtom, useAtomValue } from 'jotai'
import { Trash2Icon, Paintbrush } from 'lucide-react'

import { twMerge } from 'tailwind-merge'

import LogoMark from '@/containers/Brand/Logo/Mark'
import { currentPromptAtom } from '@/containers/Providers/Jotai'

import ShortCut from '@/containers/Shortcut'

import { MainViewState } from '@/constants/screens'

import { useActiveModel } from '@/hooks/useActiveModel'
import useDeleteThread from '@/hooks/useDeleteConversation'

import { useGetDownloadedModels } from '@/hooks/useGetDownloadedModels'
import { useMainViewState } from '@/hooks/useMainViewState'

import useSendChatMessage from '@/hooks/useSendChatMessage'

import ChatBody from '@/screens/Chat/ChatBody'

import ThreadList from '@/screens/Chat/ThreadList'

import Sidebar from './Sidebar'

import {
  activeThreadAtom,
  getActiveThreadIdAtom,
  threadsAtom,
  waitingToSendMessage,
} from '@/helpers/atoms/Conversation.atom'

import { activeThreadStateAtom } from '@/helpers/atoms/Conversation.atom'

const ChatScreen = () => {
  const currentConvo = useAtomValue(activeThreadAtom)
  const { downloadedModels } = useGetDownloadedModels()
  const { deleteThread, cleanThread } = useDeleteThread()
  const { activeModel, stateModel } = useActiveModel()
  const { setMainViewState } = useMainViewState()

  const [currentPrompt, setCurrentPrompt] = useAtom(currentPromptAtom)
  const currentConvoState = useAtomValue(activeThreadStateAtom)
  const { sendChatMessage } = useSendChatMessage()
  const isWaitingForResponse = currentConvoState?.waitingForResponse ?? false
  const disabled = currentPrompt.trim().length === 0 || isWaitingForResponse

  const activeThreadId = useAtomValue(getActiveThreadIdAtom)
  const [isWaitingToSend, setIsWaitingToSend] = useAtom(waitingToSendMessage)
  const conversations = useAtomValue(threadsAtom)
  const isEnableChat = currentConvo && activeModel

  // console.log(conversations)
  // console.log(activeModel)

  const [isModelAvailable, setIsModelAvailable] = useState(
    true
    // downloadedModels.some((x) => x.id === currentConvo?.modelId)
  )
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

  return (
    <div className="flex h-full w-full">
      <div className="flex h-full w-60 flex-shrink-0 flex-col overflow-y-auto border-r border-border bg-background">
        <ThreadList />
      </div>
      <div className="relative flex h-full w-[calc(100%-240px)] flex-col bg-background">
        <div className="flex h-full w-full flex-col justify-between">
          {/* {isEnableChat && currentConvo && (
            <div className="h-[53px] flex-shrink-0 border-b border-border bg-background p-4">
              <div className="flex items-center justify-between">
                <span>{currentConvo.title}</span>
                <div
                  className={twMerge(
                    'flex items-center space-x-3',
                    !isModelAvailable && '-mt-1'
                  )}
                >
                  {!isModelAvailable && (
                    <Button
                      themes="secondary"
                      className="relative z-10"
                      size="sm"
                      onClick={() => setMainViewState(MainViewState.Hub)}
                    >
                      Download Model
                    </Button>
                  )}
                  <Paintbrush
                    size={16}
                    className="cursor-pointer text-muted-foreground"
                    onClick={() => cleanThread()}
                  />
                  <Trash2Icon
                    size={16}
                    className="cursor-pointer text-muted-foreground"
                    onClick={() => deleteThread()}
                  />
                </div>
              </div>
            </div>
          )} */}

          {isEnableChat ? (
            <div className="flex h-full w-full overflow-y-auto overflow-x-hidden">
              <ChatBody />
            </div>
          ) : (
            <div className="mx-auto mt-8 flex h-full w-3/4 flex-col items-center justify-center text-center">
              {downloadedModels.length === 0 ? (
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
              ) : (
                <Fragment>
                  <LogoMark
                    className="mx-auto mb-4 animate-wave"
                    width={56}
                    height={56}
                  />

                  <p className="mt-1 text-base">You need to choose a model</p>
                </Fragment>
              )}
            </div>
          )}

          <div className="mx-auto flex w-full flex-shrink-0 items-center justify-center space-x-4 px-8 py-4">
            <Textarea
              className="min-h-10 h-10 max-h-16 resize-none pr-20"
              ref={textareaRef}
              onKeyDown={(e) => onKeyDown(e)}
              placeholder="Enter your message..."
              disabled={stateModel.loading || !currentConvo}
              value={currentPrompt}
              onChange={(e) => onPromptChange(e)}
            />
            <Button
              size="lg"
              disabled={disabled || stateModel.loading || !currentConvo}
              themes={'primary'}
              onClick={sendChatMessage}
            >
              Send
            </Button>
          </div>
        </div>
      </div>
      {/* Sidebar */}
      <Sidebar />
    </div>
  )
}

export default ChatScreen
