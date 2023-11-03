import { useEffect } from 'react'

import { useAtomValue } from 'jotai'

import { twMerge } from 'tailwind-merge'

import { searchAtom } from '@/containers/Providers/Jotai'

import useGetUserConversations from '@/hooks/useGetUserConversations'

import ExpandableHeader from '../ExpandableHeader'
import HistoryItem from '../HistoryItem'

import SidebarEmptyHistory from '../SidebarEmptyHistory'

import { userConversationsAtom } from '@/helpers/atoms/Conversation.atom'

const HistoryList: React.FC = () => {
  const conversations = useAtomValue(userConversationsAtom)
  const searchText = useAtomValue(searchAtom)
  const { getUserConversations } = useGetUserConversations()

  useEffect(() => {
    getUserConversations()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="flex flex-grow flex-col gap-2 px-4 pb-4">
      <ExpandableHeader title="CHAT HISTORY" />
      {conversations.length > 0 ? (
        <ul className={twMerge('mt-1 flex flex-col gap-y-3 overflow-y-auto')}>
          {conversations
            .filter(
              (e) =>
                searchText.trim() === '' ||
                e.name?.toLowerCase().includes(searchText.toLowerCase().trim())
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
      ) : (
        <SidebarEmptyHistory />
      )}
    </div>
  )
}

export default HistoryList
