import { useCallback, useEffect, useState } from 'react'

import { joinPath, openFileExplorer } from '@janhq/core'
import { Button, Modal } from '@janhq/joi'
import { useAtomValue, useSetAtom } from 'jotai'

import { AlertCircle } from 'lucide-react'

import {
  getImportModelStageAtom,
  setImportModelStageAtom,
} from '@/hooks/useImportModel'

import { openFileTitle } from '@/utils/titleUtils'

import ImportingModelItem from './ImportingModelItem'

import { janDataFolderPathAtom } from '@/helpers/atoms/AppConfig.atom'
import { importingModelsAtom } from '@/helpers/atoms/Model.atom'

const ImportingModelModal: React.FC = () => {
  const importingModels = useAtomValue(importingModelsAtom)
  const importModelStage = useAtomValue(getImportModelStageAtom)
  const setImportModelStage = useSetAtom(setImportModelStageAtom)
  const janDataFolder = useAtomValue(janDataFolderPathAtom)

  const [modelFolder, setModelFolder] = useState('')

  useEffect(() => {
    const getModelPath = async () => {
      const modelPath = await joinPath([janDataFolder, 'models'])
      setModelFolder(modelPath)
    }
    getModelPath()
  }, [janDataFolder])

  const finishedImportModel = importingModels.filter(
    (model) => model.status === 'IMPORTED'
  ).length

  const onOpenModelFolderClick = useCallback(() => {
    openFileExplorer(modelFolder)
  }, [modelFolder])

  return (
    <Modal
      open={importModelStage === 'IMPORTING_MODEL'}
      onOpenChange={() => setImportModelStage('NONE')}
      title={`Importing model (${finishedImportModel}/${importingModels.length})`}
      content={
        <div>
          <div className="flex flex-row items-center space-x-2">
            <label className="text-[hsla(var(--app-text-secondary)] text-xs">
              {modelFolder}
            </label>
            <Button theme="ghost" onClick={onOpenModelFolderClick}>
              {openFileTitle()}
            </Button>
          </div>

          <div className="space-y-3">
            {importingModels.map((model) => (
              <ImportingModelItem key={model.importId} model={model} />
            ))}
          </div>

          <div className="mx-[-16px] mb-[-16px] flex flex-row rounded-b-lg bg-[#F4F4F5] px-2 py-2 dark:bg-secondary	">
            <AlertCircle size={20} />
            <p className="text-[hsla(var(--app-text-secondary)] text-sm font-semibold">
              Own your model configurations, use at your own risk.
              Misconfigurations may result in lower quality or unexpected
              outputs.{' '}
            </p>
          </div>
        </div>
      }
    />
  )
}

export default ImportingModelModal
