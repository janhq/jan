import { useEffect } from 'react'

import { Button } from '@janhq/uikit'
import { useAtomValue, useSetAtom } from 'jotai'

import { GalleryHorizontalEndIcon } from 'lucide-react'

import { useActiveModel } from '@/hooks/useActiveModel'
import useCreateConversation from '@/hooks/useCreateConversation'
import { useGetModelById } from '@/hooks/useGetModelById'
import useGetUserConversations from '@/hooks/useGetUserConversations'

import { displayDate } from '@/utils/datetime'

import {
  getActiveConvoIdAtom,
  setActiveConvoIdAtom,
  userConversationsAtom,
} from '@/helpers/atoms/Conversation.atom'

export default function HistoryList() {
  const conversations = useAtomValue(userConversationsAtom)
  // const searchText = useAtomValue(searchAtom)
  const { getUserConversations } = useGetUserConversations()
  const { activeModel, startModel } = useActiveModel()
  const { requestCreateConvo } = useCreateConversation()
  const activeConvoId = useAtomValue(getActiveConvoIdAtom)
  const { getModelById } = useGetModelById()
  const setActiveConvoId = useSetAtom(setActiveConvoIdAtom)

  useEffect(() => {
    getUserConversations()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleClickConversation = () => {
    if (activeModel) requestCreateConvo(activeModel as AssistantModel)
    return
  }

  const handleActiveModel = async (convo: Conversation) => {
    if (convo.modelId == null) {
      console.debug('modelId is undefined')
      return
    }
    const model = await getModelById(convo.modelId)
    if (convo == null) {
      console.debug('modelId is undefined')
      return
    }
    if (model != null) {
      if (activeModel == null) {
        startModel(model._id)
      }
    }
    if (activeConvoId !== convo._id) {
      setActiveConvoId(convo._id)
    }
  }

  return (
    <div>
      <div className="sticky top-0 z-20 flex flex-col border-b border-border px-4 py-3">
        <Button size="sm" themes="outline" onClick={handleClickConversation}>
          Create New Chat
        </Button>
      </div>

      {conversations.length === 0 ? (
        <div className="px-4 py-8 text-center">
          <GalleryHorizontalEndIcon size={24} className="mx-auto mb-3" />
          <h2 className="font-semibold">No Chat History</h2>
          <p className="mt-1 text-xs">Get started by creating a new chat</p>
        </div>
      ) : (
        conversations.map((convo, i) => {
          return (
            <div
              key={i}
              className="relative flex cursor-pointer flex-col border-b border-border px-4 py-2 transition-colors hover:bg-secondary/10"
              onClick={() => handleActiveModel(convo)}
            >
              <p className="mb-1 line-clamp-1 text-xs leading-5">
                {convo.updatedAt &&
                  displayDate(new Date(convo.updatedAt).getTime())}
              </p>
              <span className="line-clamp-1">
                {convo.summary ?? convo.name}
              </span>
              <p className="mt-1 line-clamp-2 text-xs leading-relaxed">
                {convo?.lastMessage ?? 'No new message'}
              </p>
            </div>
          )
        })
      )}
    </div>
  )
}
