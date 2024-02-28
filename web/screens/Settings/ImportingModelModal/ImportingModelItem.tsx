import { useCallback, useMemo } from 'react'

import { ImportingModel } from '@janhq/core/.'
import { useSetAtom } from 'jotai'

import { AlertCircle } from 'lucide-react'

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

  const onEditModelInfoClick = useCallback(() => {
    setEditingModelId(model.importId)
    setImportModelStage('EDIT_MODEL_INFO')
  }, [setImportModelStage, setEditingModelId, model.importId])

  const onDeleteModelClick = useCallback(() => {}, [])

  const displayStatus = useMemo(() => {
    if (model.status === 'FAILED') {
      return 'Failed'
    } else {
      return toGibibytes(model.size)
    }
  }, [model.status, model.size])

  return (
    <div className="flex w-full flex-row items-center space-x-3 rounded-lg border px-4 py-3">
      <p className="line-clamp-1 flex-1 font-semibold text-[#09090B]">
        {model.name}
      </p>
      <p className="text-[#71717A]">{displayStatus}</p>

      {model.status === 'IMPORTED' && (
        <ImportSuccessIcon onEditModelClick={onEditModelInfoClick} />
      )}
      {(model.status === 'IMPORTING' || model.status === 'PREPARING') && (
        <ImportInProgressIcon
          percentage={model.percentage ?? 0}
          onDeleteModelClick={onDeleteModelClick}
        />
      )}
      {model.status === 'FAILED' && <AlertCircle size={24} color="#F00" />}
    </div>
  )
}

export default ImportingModelItem
