import React, { useState } from 'react'
import { Button } from '@uikit'
import ModelActionMenu from '../ModelActionMenu'
import { useAtomValue } from 'jotai'

import { stateModel } from '@helpers/atoms/Model.atom'

export enum ModelActionType {
  Start = 'Start',
  Stop = 'Stop',
}

type ModelActionStyle = {
  title: string
}

const modelActionMapper: Record<ModelActionType, ModelActionStyle> = {
  [ModelActionType.Start]: {
    title: 'Start',
  },
  [ModelActionType.Stop]: {
    title: 'Stop',
  },
}

type Props = {
  disabled?: boolean
  type: ModelActionType
  onActionClick: (type: ModelActionType) => void
  onDeleteClick: () => void
}

const ModelActionButton: React.FC<Props> = ({
  disabled = false,
  type,
  onActionClick,
  onDeleteClick,
}) => {
  const styles = modelActionMapper[type]
  // const { startingModel } = useStartStopModel()

  const onClick = () => {
    onActionClick(type)
  }

  const state = useAtomValue(stateModel)

  return (
    <td className="whitespace-nowrap px-3 py-2 text-right">
      <div className="flex items-center justify-end gap-x-4">
        <ModelActionMenu onDeleteClick={onDeleteClick} />
        <Button
          disabled={disabled}
          size="sm"
          themes={styles.title === 'Start' ? 'accent' : 'default'}
          onClick={() => onClick()}
          loading={state.loading}
        >
          {styles.title} Model
        </Button>
      </div>
    </td>
  )
}

export default ModelActionButton
