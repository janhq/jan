import { useEffect } from 'react'

import { Modal } from '@janhq/joi'
import { useAtomValue, useSetAtom } from 'jotai'

import { AlertCircle } from 'lucide-react'

import useCortex from '@/hooks/useCortex'
import {
  getImportModelStageAtom,
  setImportModelStageAtom,
} from '@/hooks/useImportModel'

import ImportingModelItem from './ImportingModelItem'

import { importingModelsAtom } from '@/helpers/atoms/Model.atom'

const ImportingModelModal = () => {
  const { downloadModel } = useCortex()
  const setImportModelStage = useSetAtom(setImportModelStageAtom)
  const importingModels = useAtomValue(importingModelsAtom)
  const importModelStage = useAtomValue(getImportModelStageAtom)

  const finishedImportModel = importingModels.filter(
    (model) => model.status === 'IMPORTED'
  ).length

  useEffect(() => {
    const importModels = async () => {
      for (const model of importingModels) {
        await downloadModel(model.path)
        // const parsedResult = await result?.json()
        // if (
        //   parsedResult['message'] &&
        //   parsedResult['message'] === 'Download model started successfully.'
        // ) {
        //   // update importingModels
        // }
        // console.log(`NamH result ${JSON.stringify(parsedResult)}`)
      }
    }
    importModels()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [downloadModel])

  return (
    <Modal
      open={importModelStage === 'IMPORTING_MODEL'}
      onOpenChange={() => setImportModelStage('NONE')}
      title={`Importing model (${finishedImportModel}/${importingModels.length})`}
      content={
        <div>
          <div className="flex flex-row items-center space-x-2 pb-3">
            {/* <label className="text-[hsla(var(--text-secondary)] text-xs">
              {modelFolder}
            </label>
            <Button
              theme="ghost"
              size="small"
              variant="outline"
              onClick={onOpenModelFolderClick}
            >
              {openFileTitle()}
            </Button> */}
          </div>

          <div className="mb-2 space-y-3">
            {importingModels.map((model) => (
              <ImportingModelItem key={model.importId} model={model} />
            ))}
          </div>

          <div>
            <div className="flex flex-row gap-2 rounded-b-lg border-t border-[hsla(var(--app-border))] py-2">
              <AlertCircle
                size={16}
                className="mt-1 flex-shrink-0 text-[hsla(var(--warning-bg))]"
              />
              <p className="text-[hsla(var(--text-secondary)] font-semibold">
                Own your model configurations, use at your own risk.
                Misconfigurations may result in lower quality or unexpected
                outputs.
              </p>
            </div>
          </div>
        </div>
      }
    />
  )
}

export default ImportingModelModal
