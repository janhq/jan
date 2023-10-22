import React, { useCallback } from 'react'
import { ModelStatus, ModelStatusComponent } from '../ModelStatusComponent'
import ModelActionMenu from '../ModelActionMenu'
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
  }, [model])

  return (
    <tr className="border-b border-gray-200 last:rounded-lg last:border-b-0">
      <td className="flex flex-col whitespace-nowrap px-6 py-4 text-sm font-medium text-gray-900">
        {model.name}
        <span className="font-normal text-gray-500">{model.version}</span>
      </td>
      <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
        <div className="flex flex-col justify-start">
          <span>GGUF</span>
        </div>
      </td>
      <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
        {toGigabytes(model.size)}
      </td>
      <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
        <ModelStatusComponent status={status} />
      </td>
      <ModelActionButton
        type={actionButtonType}
        onActionClick={onModelActionClick}
      />
      <td className="relative w-fit whitespace-nowrap px-6 py-4 text-right text-sm font-medium">
        <ModelActionMenu onDeleteClick={onDeleteClick} />
      </td>
    </tr>
  )
}

export default ModelRow
