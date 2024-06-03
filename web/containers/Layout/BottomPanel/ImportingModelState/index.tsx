import { Fragment, useCallback } from 'react'

import { Progress } from '@janhq/joi'
import { useAtomValue, useSetAtom } from 'jotai'

import { setImportModelStageAtom } from '@/hooks/useImportModel'

import { importingModelsAtom } from '@/helpers/atoms/Model.atom'

const ImportingModelState = () => {
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
          className="flex cursor-pointer flex-row items-center gap-x-2"
          onClick={onClick}
        >
          <p className="text-[hsla(var(--text-secondary)] font-medium">
            Importing model ({finishedImportModelCount}/{importingModels.length}
            )
          </p>

          <div className="flex flex-row items-center justify-center gap-x-2 rounded-md">
            <Progress
              size="small"
              className="w-20"
              value={transferredSize / totalSize}
            />
            <span className="text-[hsla(var(--primary-bg)] font-medium">
              {progress.toFixed(2)}%
            </span>
          </div>
        </div>
      ) : null}
    </Fragment>
  )
}

export default ImportingModelState
