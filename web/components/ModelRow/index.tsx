import React, { useCallback } from 'react'

import { useAtomValue } from 'jotai'

import useDeleteModel from '@/hooks/useDeleteModel'
import useStartStopModel from '@/hooks/useStartStopModel'

import { toGigabytes } from '@/utils/converter'

import ModelActionButton, { ModelActionType } from '../ModelActionButton'
import { ModelStatus, ModelStatusComponent } from '../ModelStatusComponent'

import {
  activeAssistantModelAtom,
  stateModel,
} from '@/helpers/atoms/Model.atom'

type Props = {
  model: Model
}

const ModelRow: React.FC<Props> = ({ model }) => {
  const { startModel, stopModel } = useStartStopModel()
  const activeModel = useAtomValue(activeModelAtom)
  const { deleteModel } = useDeleteModel()
  const { loading, model: currentModelState } = useAtomValue(stateModel)

  let status = ModelStatus.Installed
  if (activeModel && activeModel._id === model._id) {
    status = ModelStatus.Active
  }

  let actionButtonType = ModelActionType.Start
  if (activeModel && activeModel._id === model._id) {
    actionButtonType = ModelActionType.Stop
  }

  const onModelActionClick = (action: ModelActionType) => {
    if (action === ModelActionType.Start) {
      startModel(model._id)
    } else {
      stopModel(model._id)
    }
  }

  const onDeleteClick = useCallback(() => {
    deleteModel(model)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model])

  return (
    <tr className="border-border border-b bg-background/50 last:rounded-lg last:border-b-0">
      <td className="text-muted-foreground whitespace-nowrap px-3 font-semibold">
        {model.name}
        <span className="ml-2 font-semibold">v{model.version}</span>
      </td>
      <td className="text-muted-foreground whitespace-nowrap px-3">
        <div className="flex flex-col justify-start">
          <span>GGUF</span>
        </div>
      </td>
      <td className="text-muted-foreground whitespace-nowrap px-3">
        {toGigabytes(model.size)}
      </td>
      <td className="text-muted-foreground whitespace-nowrap px-3">
        <ModelStatusComponent status={status} />
      </td>
      <ModelActionButton
        disabled={loading}
        loading={currentModelState === model._id ? loading : false}
        type={actionButtonType}
        onActionClick={onModelActionClick}
        onDeleteClick={onDeleteClick}
      />
    </tr>
  )
}

export default ModelRow
