import React from 'react'

import { useAtomValue, useSetAtom } from 'jotai'

import { twMerge } from 'tailwind-merge'

import useGetModelById from '@/hooks/useGetModelById'
import useStartStopModel from '@/hooks/useStartStopModel'

import { displayDate } from '@/utils/datetime'

import {
  getActiveConvoIdAtom,
  setActiveConvoIdAtom,
} from '@/helpers/atoms/Conversation.atom'
import {
  setMainViewStateAtom,
  MainViewState,
} from '@/helpers/atoms/MainView.atom'

import { activeAssistantModelAtom } from '@/helpers/atoms/Model.atom'

type Props = {
  conversation: Conversation
  name: string
  summary?: string
  updatedAt?: string
}

const HistoryItem: React.FC<Props> = ({
  conversation,
  name,
  summary,
  updatedAt,
}) => {
  const activeConvoId = useAtomValue(getActiveConvoIdAtom)
  const isSelected = activeConvoId === conversation._id
  const activeModel = useAtomValue(activeModelAtom)
  const { startModel } = useStartStopModel()

  const setMainViewState = useSetAtom(setMainViewStateAtom)
  const setActiveConvoId = useSetAtom(setActiveConvoIdAtom)
  const models = useAtomValue(downloadedModelAtom)

  const onClick = async () => {
    if (conversation.modelId == null) {
      console.debug('modelId is undefined')
      return
    }

    const model = models.find((e) => e._id === conversation.modelId)
    if (model != null) {
      if (activeModel == null) {
        // if there's no active model, we simply load conversation's model
        startModel(model._id)
      } else if (activeModel._id !== model._id) {
        // display confirmation modal
        // TODO: temporarily disabled
        // setConfirmationModalProps({
        //   replacingModel: model,
        // })
      }
    }

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
        'border-border flex flex-row rounded-md border p-3',
        backgroundColor
      )}
      onClick={onClick}
    >
      <div className="flex flex-1 flex-col">
        {/* title */}

        <span className="text-muted-foreground mb-1 line-clamp-1 leading-5">
          {updatedAt && displayDate(new Date(updatedAt).getTime())}
        </span>

        <span className="line-clamp-1">{summary ?? name}</span>

        {/* description */}
        <span className="text-muted-foreground mt-1 line-clamp-2">
          {description}
        </span>
      </div>
    </li>
  )
}

export default HistoryItem
