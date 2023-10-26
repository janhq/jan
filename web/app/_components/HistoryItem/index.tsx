import React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
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
import { activeAssistantModelAtom } from '@helpers/atoms/Model.atom'
import { switchingModelConfirmationModalPropsAtom } from '@helpers/atoms/Modal.atom'
import useStartStopModel from '@hooks/useStartStopModel'
import useGetModelById from '@hooks/useGetModelById'

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
  const activeModel = useAtomValue(activeAssistantModelAtom)
  const { startModel } = useStartStopModel()
  const { getModelById } = useGetModelById()

  const setMainViewState = useSetAtom(setMainViewStateAtom)
  const setActiveConvoId = useSetAtom(setActiveConvoIdAtom)
  const updateConvWaiting = useSetAtom(updateConversationWaitingForResponseAtom)
  const setConfirmationModalProps = useSetAtom(
    switchingModelConfirmationModalPropsAtom
  )

  const onClick = async () => {
    if (conversation.modelId == null) {
      console.debug('modelId is undefined')
      return
    }

    const model = await getModelById(conversation.modelId)
    if (model != null) {
      if (activeModel == null) {
        // if there's no active model, we simply load conversation's model
        startModel(model._id)
      } else if (activeModel._id !== model._id) {
        // display confirmation modal
        setConfirmationModalProps({
          replacingModel: model,
        })
      }
    }

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
