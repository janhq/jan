import HistoryItem from '../HistoryItem'
import { Fragment, useEffect } from 'react'
import ExpandableHeader from '../ExpandableHeader'
import { useAtomValue, useSetAtom } from 'jotai'
import { searchAtom } from '@helpers/JotaiWrapper'
import useGetUserConversations from '@hooks/useGetUserConversations'
import SidebarEmptyHistory from '../SidebarEmptyHistory'
import { userConversationsAtom } from '@helpers/atoms/Conversation.atom'
import { twMerge } from 'tailwind-merge'
import { Button } from '@uikit'
import { activeAssistantModelAtom, stateModel } from '@helpers/atoms/Model.atom'
import useCreateConversation from '@hooks/useCreateConversation'
import { showingModalNoActiveModel } from '@helpers/atoms/Modal.atom'
import { PlusIcon } from '@heroicons/react/24/outline'

const HistoryList: React.FC = () => {
  const conversations = useAtomValue(userConversationsAtom)
  const searchText = useAtomValue(searchAtom)
  const { getUserConversations } = useGetUserConversations()
  const activeModel = useAtomValue(activeAssistantModelAtom)
  const { requestCreateConvo } = useCreateConversation()
  const setShowModalNoActiveModel = useSetAtom(showingModalNoActiveModel)

  const onNewConversationClick = () => {
    if (activeModel) {
      requestCreateConvo(activeModel)
    } else {
      setShowModalNoActiveModel(true)
    }
  }

  useEffect(() => {
    getUserConversations()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="flex flex-grow flex-col gap-2">
      <ExpandableHeader title="CHAT HISTORY" />
      {conversations.length > 0 ? (
        <Fragment>
          <ul className={twMerge('mt-1 flex flex-col gap-y-3 overflow-y-auto')}>
            {conversations
              .filter(
                (e) =>
                  searchText.trim() === '' ||
                  e.name
                    ?.toLowerCase()
                    .includes(searchText.toLowerCase().trim())
              )
              .map((convo, i) => (
                <HistoryItem
                  key={i}
                  conversation={convo}
                  summary={convo.summary}
                  name={convo.name || 'Jan'}
                  updatedAt={convo.updatedAt ?? ''}
                />
              ))}
          </ul>
          <Button
            onClick={onNewConversationClick}
            className="mt-2 flex items-center space-x-2"
          >
            <PlusIcon width={16} height={16} />
            <span>New Conversation</span>
          </Button>
        </Fragment>
      ) : (
        <SidebarEmptyHistory />
      )}
    </div>
  )
}

export default HistoryList
