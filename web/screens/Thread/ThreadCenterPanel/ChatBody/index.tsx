import { MessageStatus } from '@janhq/core'

import { useAtomValue } from 'jotai'

import ErrorMessage from '@/containers/ErrorMessage'
import ListContainer from '@/containers/ListContainer'

import { loadModelErrorAtom } from '@/hooks/useActiveModel'

import ChatItem from '../ChatItem'

import LoadModelError from '../LoadModelError'

import EmptyModel from './EmptyModel'
import EmptyThread from './EmptyThread'

import { getCurrentChatMessagesAtom } from '@/helpers/atoms/ChatMessage.atom'
import { downloadedModelsAtom } from '@/helpers/atoms/Model.atom'

const ChatBody = () => {
  const messages = useAtomValue(getCurrentChatMessagesAtom)
  const downloadedModels = useAtomValue(downloadedModelsAtom)
  const loadModelError = useAtomValue(loadModelErrorAtom)

  if (!downloadedModels.length) return <EmptyModel />
  if (!messages.length) return <EmptyThread />

  return (
    <ListContainer>
      {messages.map((message, index) => (
        <div
          key={message.id}
          className="border-b border-[hsla(var(--app-border))] last:border-none"
        >
          {message.status !== MessageStatus.Error &&
            message.content.length > 0 && (
              <ChatItem {...message} key={message.id} />
            )}

          {!loadModelError &&
            index === messages.length - 1 &&
            message.status !== MessageStatus.Pending &&
            message.status !== MessageStatus.Ready && (
              <ErrorMessage message={message} />
            )}
        </div>
      ))}
      {loadModelError && <LoadModelError />}
    </ListContainer>
  )
}

export default ChatBody
