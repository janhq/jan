import React, { useCallback } from 'react'
import { ModelStatus, ModelStatusComponent } from '../ModelStatusComponent'
import { useAtomValue } from 'jotai'
import ModelActionButton, { ModelActionType } from '../ModelActionButton'
import useStartStopModel from '@hooks/useStartStopModel'
import useDeleteModel from '@hooks/useDeleteModel'
import { activeAssistantModelAtom } from '@helpers/atoms/Model.atom'
import { toGigabytes } from '@utils/converter'

type Props = {
  model: AssistantModel
}

const ModelRow: React.FC<Props> = ({ model }) => {
  const { startModel, stopModel } = useStartStopModel()
  const activeModel = useAtomValue(activeAssistantModelAtom)
  const { deleteModel } = useDeleteModel()

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
    <tr className="border-b border-border bg-background/50 last:rounded-lg last:border-b-0">
      <td className="whitespace-nowrap px-3 font-semibold text-muted-foreground">
        {model.name}
        <span className="ml-2 font-semibold">v{model.version}</span>
      </td>
      <td className="whitespace-nowrap px-3 text-muted-foreground">
        <div className="flex flex-col justify-start">
          <span>GGUF</span>
        </div>
      </td>
      <td className="whitespace-nowrap px-3 text-muted-foreground">
        {toGigabytes(model.size)}
      </td>
      <td className="whitespace-nowrap px-3 text-muted-foreground">
        <ModelStatusComponent status={status} />
      </td>
      <ModelActionButton
        type={actionButtonType}
        onActionClick={onModelActionClick}
        onDeleteClick={onDeleteClick}
      />
    </tr>
  )
}

export default ModelRow
