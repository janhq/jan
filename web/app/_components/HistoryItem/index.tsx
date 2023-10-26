import React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { ModelManagementService } from '@janhq/core'
import {
  getActiveConvoIdAtom,
  setActiveConvoIdAtom,
  updateConversationWaitingForResponseAtom,
} from '@helpers/atoms/Conversation.atom'
import {
  setMainViewStateAtom,
  MainViewState,
} from '@helpers/atoms/MainView.atom'
import { displayDate } from '@utils/datetime'
import { twMerge } from 'tailwind-merge'
import { executeSerial } from '@services/pluginService'

type Props = {
  conversation: Conversation
  avatarUrl?: string
  name: string
  summary?: string
  updatedAt?: string
}

const HistoryItem: React.FC<Props> = ({
  conversation,
  avatarUrl,
  name,
  summary,
  updatedAt,
}) => {
  const setMainViewState = useSetAtom(setMainViewStateAtom)
  const activeConvoId = useAtomValue(getActiveConvoIdAtom)
  const setActiveConvoId = useSetAtom(setActiveConvoIdAtom)
  const updateConvWaiting = useSetAtom(updateConversationWaitingForResponseAtom)
  const isSelected = activeConvoId === conversation._id

  const onClick = async () => {
    const model = await executeSerial(
      ModelManagementService.GetModelById,
      conversation.modelId
    )

    if (conversation._id) updateConvWaiting(conversation._id, true)

    if (activeConvoId !== conversation._id) {
      setMainViewState(MainViewState.Conversation)
      setActiveConvoId(conversation._id)
    }
  }

  const backgroundColor = isSelected ? 'bg-background/80' : 'bg-background/20'
  const description = conversation?.lastMessage ?? 'No new message'

  return (
    <li
      role="button"
      className={twMerge(
        'flex flex-row rounded-md border border-border p-3',
        backgroundColor
      )}
      onClick={onClick}
    >
      <div className="flex flex-1 flex-col">
        {/* title */}

        <span className="mb-1 line-clamp-1 leading-5 text-muted-foreground">
          {updatedAt && displayDate(new Date(updatedAt).getTime())}
        </span>

        <span className="line-clamp-1">{summary ?? name}</span>

        {/* description */}
        <span className="mt-1 line-clamp-2 text-muted-foreground">
          {description}
        </span>
      </div>
    </li>
  )
}

export default HistoryItem
