import { MessageStatus } from '@janhq/core'
import { useAtomValue } from 'jotai'

import ListContainer from '@/containers/ListContainer'

import { loadModelErrorAtom } from '@/hooks/useActiveModel'

import ChatItem from '../ChatItem'

import ErrorMessage from '../ErrorMessage'

import LoadModelError from '../LoadModelError'

import EmptyModel from './EmptyModel'
import EmptyThread from './EmptyThread'

import { getCurrentChatMessagesAtom } from '@/helpers/atoms/ChatMessage.atom'
import { downloadedModelsAtom } from '@/helpers/atoms/Model.atom'

const ChatBody: React.FC = () => {
  const messages = useAtomValue(getCurrentChatMessagesAtom)
  const downloadedModels = useAtomValue(downloadedModelsAtom)
  const loadModelError = useAtomValue(loadModelErrorAtom)

  if (downloadedModels.length === 0) return <EmptyModel />
  if (messages.length === 0) return <EmptyThread />

  return (
    <ListContainer>
      {messages.map((message, index) => (
        <div key={message.id}>
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
