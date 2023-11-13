import { useEffect } from 'react'

import { Conversation, Model } from '@janhq/core/lib/types'
import { Button } from '@janhq/uikit'
import { motion as m } from 'framer-motion'
import { useAtomValue, useSetAtom } from 'jotai'

import { GalleryHorizontalEndIcon } from 'lucide-react'

import { twMerge } from 'tailwind-merge'

import { useActiveModel } from '@/hooks/useActiveModel'
import { useCreateConversation } from '@/hooks/useCreateConversation'
import { useGetDownloadedModels } from '@/hooks/useGetDownloadedModels'
import useGetUserConversations from '@/hooks/useGetUserConversations'

import { displayDate } from '@/utils/datetime'

import {
  getActiveConvoIdAtom,
  setActiveConvoIdAtom,
  userConversationsAtom,
} from '@/helpers/atoms/Conversation.atom'

export default function HistoryList() {
  const conversations = useAtomValue(userConversationsAtom)
  const { getUserConversations } = useGetUserConversations()
  const { activeModel, startModel } = useActiveModel()
  const { requestCreateConvo } = useCreateConversation()
  const activeConvoId = useAtomValue(getActiveConvoIdAtom)
  const setActiveConvoId = useSetAtom(setActiveConvoIdAtom)
  const { downloadedModels } = useGetDownloadedModels()

  useEffect(() => {
    getUserConversations()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleClickConversation = () => {
    if (activeModel) requestCreateConvo(activeModel as Model)
    return
  }

  const handleActiveModel = async (convo: Conversation) => {
    if (convo.modelId == null) {
      console.debug('modelId is undefined')
      return
    }
    const model = downloadedModels.find((e) => e.id === convo.modelId)
    if (convo == null) {
      console.debug('modelId is undefined')
      return
    }
    if (model != null) {
      startModel(model.id)
    }
    if (activeConvoId !== convo.id) {
      setActiveConvoId(convo.id)
    }
  }

  return (
    <div>
      <div className="sticky top-0 z-20 flex flex-col border-b border-border bg-background px-4 py-3">
        <Button
          size="sm"
          themes="secondary"
          onClick={handleClickConversation}
          disabled={!activeModel}
        >
          Create New Chat
        </Button>
      </div>

      {conversations.length === 0 ? (
        <div className="px-4 py-8 text-center">
          <GalleryHorizontalEndIcon
            size={26}
            className="mx-auto mb-3 text-muted-foreground"
          />
          <h2 className="font-semibold">No Chat History</h2>
          <p className="mt-1 text-xs">Get started by creating a new chat</p>
        </div>
      ) : (
        conversations.map((convo, i) => {
          return (
            <div
              key={i}
              className={twMerge(
                'relative flex cursor-pointer flex-col border-b border-border px-4 py-2 hover:bg-secondary/20',
                activeConvoId === convo.id && 'bg-secondary-10'
              )}
              onClick={() => handleActiveModel(convo as Conversation)}
            >
              <p className="mb-1 line-clamp-1 text-xs leading-5">
                {convo.updatedAt &&
                  displayDate(new Date(convo.updatedAt).getTime())}
              </p>
              <h2 className="line-clamp-1">{convo.summary ?? convo.name}</h2>
              <p className="mt-1 line-clamp-2 text-xs">
                {convo?.lastMessage ?? 'No new message'}
              </p>
              {activeModel && activeConvoId === convo.id && (
                <m.div
                  className="absolute right-0 top-0 h-full w-1 bg-primary/50"
                  layoutId="active-convo"
                />
              )}
            </div>
          )
        })
      )}
    </div>
  )
}
