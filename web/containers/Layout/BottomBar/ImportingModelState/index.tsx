import { Fragment, useCallback } from 'react'

import { Progress } from '@janhq/uikit'
import { useAtomValue, useSetAtom } from 'jotai'

import { setImportModelStageAtom } from '@/hooks/useImportModel'

import { importingModelsAtom } from '@/helpers/atoms/Model.atom'

const ImportingModelState: React.FC = () => {
  const importingModels = useAtomValue(importingModelsAtom)
  const setImportModelStage = useSetAtom(setImportModelStageAtom)

  const isImportingModels =
    importingModels.filter((m) => m.status === 'IMPORTING').length > 0

  const finishedImportModelCount = importingModels.filter(
    (model) => model.status === 'IMPORTED' || model.status === 'FAILED'
  ).length

  let transferredSize = 0
  importingModels.forEach((model) => {
    transferredSize += (model.percentage ?? 0) * 100 * model.size
  })

  const totalSize = importingModels.reduce((acc, model) => acc + model.size, 0)

  const progress = totalSize === 0 ? 0 : transferredSize / totalSize

  const onClick = useCallback(() => {
    setImportModelStage('IMPORTING_MODEL')
  }, [setImportModelStage])

  return (
    <Fragment>
      {isImportingModels ? (
        <div
          className="flex cursor-pointer flex-row items-center space-x-2"
          onClick={onClick}
        >
          <p className="text-xs font-semibold	text-[#09090B]">
            Importing model ({finishedImportModelCount}/{importingModels.length}
            )
          </p>

          <div className="flex flex-row items-center justify-center space-x-2 rounded-md bg-[#F4F4F5] px-2 py-[2px]">
            <Progress
              className="h-2 w-24"
              value={transferredSize / totalSize}
            />
            <span className="text-xs font-bold text-blue-600">
              {progress.toFixed(2)}%
            </span>
          </div>
        </div>
      ) : null}
    </Fragment>
  )
}

export default ImportingModelState
