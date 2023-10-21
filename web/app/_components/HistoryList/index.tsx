import HistoryItem from '../HistoryItem'
import { useEffect, useState } from 'react'
import ExpandableHeader from '../ExpandableHeader'
import { useAtomValue } from 'jotai'
import { searchAtom } from '@helpers/JotaiWrapper'
import useGetUserConversations from '@hooks/useGetUserConversations'
import SidebarEmptyHistory from '../SidebarEmptyHistory'
import { userConversationsAtom } from '@helpers/atoms/Conversation.atom'

const HistoryList: React.FC = () => {
  const conversations = useAtomValue(userConversationsAtom)
  const searchText = useAtomValue(searchAtom)
  const [expand, setExpand] = useState<boolean>(true)
  const { getUserConversations } = useGetUserConversations()

  useEffect(() => {
    getUserConversations()
  }, [])

  return (
    <div className="flex flex-grow flex-col gap-2 overflow-hidden pt-3">
      <ExpandableHeader
        title="CHAT HISTORY"
        expanded={expand}
        onClick={() => setExpand(!expand)}
      />
      <ul
        className={`scroll mt-1 flex flex-col gap-1 overflow-y-auto ${
          !expand ? 'hidden ' : 'block'
        }`}
      >
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
