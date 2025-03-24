import { useCallback, useMemo } from 'react'

import { ImportingModel } from '@janhq/core'
import { useSetAtom } from 'jotai'

import { AlertCircle } from 'lucide-react'

import { setImportModelStageAtom } from '@/hooks/useImportModel'

import { toGigabytes } from '@/utils/converter'

import { editingModelIdAtom } from '../EditModelInfoModal'
import ImportInProgressIcon from '../ImportInProgressIcon'
import ImportSuccessIcon from '../ImportSuccessIcon'

type Props = {
  model: ImportingModel
}

const ImportingModelItem = ({ model }: Props) => {
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
      return toGigabytes(model.size)
    }
  }, [model.status, model.size])

  return (
    <div className="flex w-full flex-row items-center space-x-3 rounded-lg border border-[hsla(var(--app-border))] px-4 py-3">
      <p className="line-clamp-1 flex-1 font-semibold text-[hsla(var(--text-secondary))]">
        {model.name}
      </p>
      <p className="text-[hsla(var(--text-secondary))]">{displayStatus}</p>

      {model.status === 'IMPORTED' && (
        <ImportSuccessIcon onEditModelClick={onEditModelInfoClick} />
      )}
      {(model.status === 'IMPORTING' || model.status === 'PREPARING') && (
        <ImportInProgressIcon
          percentage={model.percentage ?? 0}
          onDeleteModelClick={onDeleteModelClick}
        />
      )}
      {model.status === 'FAILED' && <AlertCircle size={24} />}
    </div>
  )
}

export default ImportingModelItem
