import { Fragment } from 'react'

import { ScrollArea, Input, Button, Badge } from '@janhq/uikit'

import { useAtom, useAtomValue } from 'jotai'
import { Trash2Icon } from 'lucide-react'

import { currentPromptAtom } from '@/containers/Providers/Jotai'

import { MainViewState } from '@/constants/screens'

import { useActiveModel } from '@/hooks/useActiveModel'

import useDeleteConversation from '@/hooks/useDeleteConversation'

import { useGetDownloadedModels } from '@/hooks/useGetDownloadedModels'

import { useMainViewState } from '@/hooks/useMainViewState'

import useSendChatMessage from '@/hooks/useSendChatMessage'

import ChatBody from '@/screens/Chat/ChatBody'

import HistoryList from '@/screens/Chat/HistoryList'

import { currentConversationAtom } from '@/helpers/atoms/Conversation.atom'

import { currentConvoStateAtom } from '@/helpers/atoms/Conversation.atom'

const ChatScreen = () => {
  const currentConvo = useAtomValue(currentConversationAtom)
  const { downloadedModels } = useGetDownloadedModels()
  const { deleteConvo } = useDeleteConversation()
  const { activeModel } = useActiveModel()
  const { setMainViewState } = useMainViewState()

  const isEnableChat = currentConvo && activeModel
  const [currentPrompt, setCurrentPrompt] = useAtom(currentPromptAtom)
  const currentConvoState = useAtomValue(currentConvoStateAtom)
  const { sendChatMessage } = useSendChatMessage()
  const isWaitingForResponse = currentConvoState?.waitingForResponse ?? false
  const disabled = currentPrompt.trim().length === 0 || isWaitingForResponse

  const handleMessageChange = (value: string) => {
    setCurrentPrompt(value)
  }

  return (
    <div className="flex h-full">
      <div className="flex h-full w-64 flex-shrink-0 flex-col border-r border-border ">
        <ScrollArea className="h-full w-full">
          <HistoryList />
        </ScrollArea>
        {/* <LeftHeaderAction /> */}
      </div>
      <div className="relative flex h-full w-full flex-col bg-background/50">
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
            <ScrollArea className="flex h-full w-full">
              <div className="p-4">
                <ChatBody />
              </div>
            </ScrollArea>
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
          <div className="flex w-full flex-shrink-0 items-center justify-center space-x-2 p-4">
            <Input
              type="text"
              placeholder="Type your message ..."
              disabled={!activeModel}
              value={currentPrompt}
              onChange={(e) => handleMessageChange(e.target.value)}
            />
            <Button
              disabled={!activeModel || disabled}
              themes={!activeModel ? 'secondary' : 'primary'}
              onClick={() => sendChatMessage()}
            >
              Send
            </Button>
          </div>
        </div>

        {/* {activeModel ? (
          <ScrollArea className="h-full w-full">
            <p>Chat</p>
          </ScrollArea>
        ) : (
          <p>
            Lorem ipsum dolor, sit amet consectetur adipisicing elit. Soluta
            tenetur libero tempore repudiandae sit quidem eveniet fuga
            distinctio. In architecto facere magnam, iste dignissimos eos iusto
            minima neque quas nobis.
          </p>
        )} */}
        {/* <MainHeader /> */}
        {/* <ChatBody /> */}
        {/* <InputToolbar /> */}
      </div>
    </div>
  )
}

export default ChatScreen
