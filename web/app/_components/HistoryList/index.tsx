import HistoryItem from '../HistoryItem'
import { useEffect, useState } from 'react'
import ExpandableHeader from '../ExpandableHeader'
import { useAtomValue } from 'jotai'
import { searchAtom } from '@helpers/JotaiWrapper'
import useGetUserConversations from '@hooks/useGetUserConversations'
import SidebarEmptyHistory from '../SidebarEmptyHistory'
import { userConversationsAtom } from '@helpers/atoms/Conversation.atom'
import { twMerge } from 'tailwind-merge'

const HistoryList: React.FC = () => {
  const conversations = useAtomValue(userConversationsAtom)
  const searchText = useAtomValue(searchAtom)
  const { getUserConversations } = useGetUserConversations()

  useEffect(() => {
    getUserConversations()
  }, [])

  return (
    <div className="flex flex-grow flex-col gap-2">
      <ExpandableHeader title="CHAT HISTORY" />
      <ul className={twMerge('mt-1 flex flex-col gap-y-3 overflow-y-auto')}>
        {conversations.length > 0 ? (
          conversations
            .filter(
              (e) =>
                searchText.trim() === '' ||
                e.name?.toLowerCase().includes(searchText.toLowerCase().trim())
            )
            .map((convo) => (
              <HistoryItem
                key={convo._id}
                conversation={convo}
                summary={convo.summary}
                avatarUrl={convo.image}
                name={convo.name || 'Jan'}
                updatedAt={convo.updatedAt ?? ''}
              />
            ))
        ) : (
          <SidebarEmptyHistory />
        )}
      </ul>
    </div>
  )
}

export default HistoryList
