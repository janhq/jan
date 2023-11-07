import { Fragment, useEffect } from 'react'

import { Model } from '@janhq/core/lib/types'
import { ScrollArea, Input, Button, Badge } from '@janhq/uikit'

import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { Trash2Icon } from 'lucide-react'

import { currentPromptAtom } from '@/containers/Providers/Jotai'

import { MainViewState } from '@/constants/screens'

import { useActiveModel } from '@/hooks/useActiveModel'

import { useCreateConversation } from '@/hooks/useCreateConversation'
import useDeleteConversation from '@/hooks/useDeleteConversation'

import { useGetDownloadedModels } from '@/hooks/useGetDownloadedModels'

import { useMainViewState } from '@/hooks/useMainViewState'

import useSendChatMessage from '@/hooks/useSendChatMessage'

import ChatBody from '@/screens/Chat/ChatBody'

import HistoryList from '@/screens/Chat/HistoryList'

import {
  currentConversationAtom,
  getActiveConvoIdAtom,
  waitingToSendMessage,
} from '@/helpers/atoms/Conversation.atom'

import { currentConvoStateAtom } from '@/helpers/atoms/Conversation.atom'

const ChatScreen = () => {
  const currentConvo = useAtomValue(currentConversationAtom)
  const { downloadedModels } = useGetDownloadedModels()
  const { deleteConvo } = useDeleteConversation()
  const { activeModel, stateModel } = useActiveModel()
  const { setMainViewState } = useMainViewState()

  const isEnableChat = currentConvo && activeModel
  const [currentPrompt, setCurrentPrompt] = useAtom(currentPromptAtom)
  const currentConvoState = useAtomValue(currentConvoStateAtom)
  const { sendChatMessage } = useSendChatMessage()
  const isWaitingForResponse = currentConvoState?.waitingForResponse ?? false
  const disabled = currentPrompt.trim().length === 0 || isWaitingForResponse
  const activeConversationId = useAtomValue(getActiveConvoIdAtom)
  const [isWaitingToSend, setIsWaitingToSend] = useAtom(waitingToSendMessage)
  const { requestCreateConvo } = useCreateConversation()

  const handleMessageChange = (value: string) => {
    setCurrentPrompt(value)
  }

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
  }, [waitingToSendMessage, activeConversationId])

  const handleKeyDown = async (
    event: React.KeyboardEvent<HTMLInputElement>
  ) => {
    if (event.key === 'Enter') {
      if (!event.shiftKey) {
        event.preventDefault()
        handleSendMessage()
      }
    }
  }

  return (
    <div className="flex h-full">
      <div className="flex h-full w-64 flex-shrink-0 flex-col border-r border-border">
        <ScrollArea className="h-full w-full">
          <HistoryList />
        </ScrollArea>
      </div>
      <div className="relative flex h-full w-full flex-col bg-muted/10">
        <div className="flex h-full w-full flex-col justify-between">
          {isEnableChat && (
            <div className="h-[53px] flex-shrink-0 border-b border-border p-4">
              <div className="flex items-center justify-between">
                <span>{currentConvo?.name ?? ''}</span>
                <Trash2Icon
                  size={16}
                  className="cursor-pointer text-muted-foreground"
                  onClick={() => deleteConvo()}
                />
              </div>
            </div>
          )}

          {isEnableChat ? (
            <div className="flex h-full w-full overflow-x-auto">
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
          <div className="flex w-full flex-shrink-0 items-center justify-center space-x-4 p-4">
            <Input
              type="text"
              className="h-10"
              onKeyDown={(e) => handleKeyDown(e)}
              placeholder="Type your message ..."
              disabled={!activeModel || stateModel.loading}
              value={currentPrompt}
              onChange={(e) => handleMessageChange(e.target.value)}
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
