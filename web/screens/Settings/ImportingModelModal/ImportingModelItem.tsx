import { ImportingModel } from '@janhq/core/.'
import { useSetAtom } from 'jotai'

import { setImportModelStageAtom } from '@/hooks/useImportModel'

import { toGibibytes } from '@/utils/converter'

import { editingModelIdAtom } from '../EditModelInfoModal'
import ImportInProgressIcon from '../ImportInProgressIcon'
import ImportSuccessIcon from '../ImportSuccessIcon'

type Props = {
  model: ImportingModel
}

const ImportingModelItem: React.FC<Props> = ({ model }) => {
  const setImportModelStage = useSetAtom(setImportModelStageAtom)
  const setEditingModelId = useSetAtom(editingModelIdAtom)
  const sizeInGb = toGibibytes(model.size)

  const onEditModelInfoClick = () => {
    setEditingModelId(model.importId)
    setImportModelStage('EDIT_MODEL_INFO')
  }

  const onDeleteModelClick = () => {}

  return (
    <div className="flex w-full flex-row items-center space-x-3 rounded-lg border px-4 py-3">
      <p className="line-clamp-1 flex-1">{model.name}</p>
      <p>{sizeInGb}</p>

      {model.status === 'IMPORTED' || model.status === 'FAILED' ? (
        <ImportSuccessIcon onEditModelClick={onEditModelInfoClick} />
      ) : (
        <ImportInProgressIcon
          percentage={model.percentage ?? 0}
          onDeleteModelClick={onDeleteModelClick}
        />
      )}
    </div>
  )
}

export default ImportingModelItem
