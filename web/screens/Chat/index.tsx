import { Fragment, useEffect, useRef, useState } from 'react'

import { Model } from '@janhq/core/lib/types'
import { Button, Badge, Textarea } from '@janhq/uikit'

import { useAtom, useAtomValue } from 'jotai'
import { Trash2Icon } from 'lucide-react'

import { twMerge } from 'tailwind-merge'

import { currentPromptAtom } from '@/containers/Providers/Jotai'

import { MainViewState } from '@/constants/screens'

import { useActiveModel } from '@/hooks/useActiveModel'

import { useCreateConversation } from '@/hooks/useCreateConversation'
import useDeleteConversation from '@/hooks/useDeleteConversation'

import { useGetDownloadedModels } from '@/hooks/useGetDownloadedModels'

import useGetUserConversations from '@/hooks/useGetUserConversations'
import { useMainViewState } from '@/hooks/useMainViewState'

import useSendChatMessage from '@/hooks/useSendChatMessage'

import ChatBody from '@/screens/Chat/ChatBody'

import HistoryList from '@/screens/Chat/HistoryList'

import {
  currentConversationAtom,
  getActiveConvoIdAtom,
  userConversationsAtom,
  waitingToSendMessage,
} from '@/helpers/atoms/Conversation.atom'

import { currentConvoStateAtom } from '@/helpers/atoms/Conversation.atom'

const ChatScreen = () => {
  const currentConvo = useAtomValue(currentConversationAtom)
  const { downloadedModels } = useGetDownloadedModels()
  const { deleteConvo } = useDeleteConversation()
  const { activeModel, stateModel } = useActiveModel()
  const { setMainViewState } = useMainViewState()

  const [currentPrompt, setCurrentPrompt] = useAtom(currentPromptAtom)
  const currentConvoState = useAtomValue(currentConvoStateAtom)
  const { sendChatMessage } = useSendChatMessage()
  const isWaitingForResponse = currentConvoState?.waitingForResponse ?? false
  const disabled = currentPrompt.trim().length === 0 || isWaitingForResponse
  const activeConversationId = useAtomValue(getActiveConvoIdAtom)
  const [isWaitingToSend, setIsWaitingToSend] = useAtom(waitingToSendMessage)
  const { requestCreateConvo } = useCreateConversation()
  const { getUserConversations } = useGetUserConversations()
  const conversations = useAtomValue(userConversationsAtom)
  const isEnableChat = (currentConvo && activeModel) || conversations.length > 0
  const [isModelAvailable, setIsModelAvailable] = useState(
    downloadedModels.some((x) => x.id === currentConvo?.modelId)
  )

  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    getUserConversations()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleMessageChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setCurrentPrompt(e.target.value)
  }

  useEffect(() => {
    setIsModelAvailable(
      downloadedModels.some((x) => x.id === currentConvo?.modelId)
    )
  }, [currentConvo, downloadedModels])

  const handleSendMessage = async () => {
    if (activeConversationId) {
      sendChatMessage()
    } else {
      setIsWaitingToSend(true)
      await requestCreateConvo(activeModel as Model)
    }
  }

  useEffect(() => {
    if (isWaitingToSend && activeConversationId) {
      setIsWaitingToSend(false)
      sendChatMessage()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waitingToSendMessage, activeConversationId])

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

  const handleKeyDown = async (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter') {
      if (!e.shiftKey) {
        e.preventDefault()
        handleSendMessage()
      }
    }
  }

  return (
    <div className="flex h-full">
      <div className="flex h-full w-64 flex-shrink-0 flex-col overflow-y-auto border-r border-border">
        <HistoryList />
      </div>
      <div className="relative flex h-full w-[calc(100%-256px)] flex-col bg-muted/10">
        <div className="flex h-full w-full flex-col justify-between">
          {isEnableChat && currentConvo && (
            <div className="h-[53px] flex-shrink-0 border-b border-border bg-background p-4">
              <div className="flex items-center justify-between">
                <span>{currentConvo?.summary ?? ''}</span>
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
                      onClick={() => {
                        setMainViewState(MainViewState.ExploreModels)
                      }}
                    >
                      Download Model
                    </Button>
                  )}
                  {!stateModel.loading && (
                    <Trash2Icon
                      size={16}
                      className="cursor-pointer text-muted-foreground"
                      onClick={() => deleteConvo()}
                    />
                  )}
                </div>
              </div>
            </div>
          )}

          {isEnableChat ? (
            <div className="flex h-full w-full overflow-y-auto overflow-x-hidden">
              <ChatBody />
            </div>
          ) : (
            <div className="mx-auto mt-8 flex h-full w-3/4 flex-col items-center justify-center text-center">
              {downloadedModels.length === 0 && (
                <Fragment>
                  <h1 className="text-lg font-medium">{`Ups, you don't have a Model`}</h1>
                  <p className="mt-1">{`let’s download your first model.`}</p>
                  <Button
                    className="mt-4"
                    onClick={() =>
                      setMainViewState(MainViewState.ExploreModels)
                    }
                  >
                    Explore Models
                  </Button>
                </Fragment>
              )}
              {!activeModel && downloadedModels.length > 0 && (
                <Fragment>
                  <h1 className="text-lg font-medium">{`You don’t have any actively running models`}</h1>
                  <p className="mt-1">{`Please start a downloaded model in My Models page to use this feature.`}</p>
                  <Badge className="mt-4" themes="secondary">
                    ⌘e to show your model
                  </Badge>
                </Fragment>
              )}
            </div>
          )}
          <div className="mx-auto flex w-full flex-shrink-0 items-center justify-center space-x-4 p-4 lg:w-3/4">
            <Textarea
              className="min-h-10 h-10 max-h-16 resize-none pr-20"
              ref={textareaRef}
              onKeyDown={(e) => handleKeyDown(e)}
              placeholder="Type your message ..."
              disabled={
                !activeModel ||
                stateModel.loading ||
                activeModel.id !== currentConvo?.modelId
              }
              value={currentPrompt}
              onChange={(e) => {
                handleMessageChange(e)
              }}
            />
            <Button
              size="lg"
              disabled={!activeModel || disabled || stateModel.loading}
              themes={!activeModel ? 'secondary' : 'primary'}
              onClick={handleSendMessage}
            >
              Send
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default ChatScreen
