import { useCallback, useEffect, useState } from 'react'

import { joinPath, openFileExplorer } from '@janhq/core'
import {
  Button,
  Modal,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from '@janhq/uikit'
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
    >
      <ModalContent>
        <ModalHeader>
          <ModalTitle>
            Importing model ({finishedImportModel}/{importingModels.length})
          </ModalTitle>
          <div className="flex flex-row items-center space-x-2">
            <label className="text-xs text-muted-foreground">
              {modelFolder}
            </label>
            <Button
              themes="ghost"
              className="text-blue-500"
              onClick={onOpenModelFolderClick}
            >
              {openFileTitle()}
            </Button>
          </div>
        </ModalHeader>

        <div className="space-y-3">
          {importingModels.map((model) => (
            <ImportingModelItem key={model.importId} model={model} />
          ))}
        </div>
        <ModalFooter className="mx-[-16px] mb-[-16px] flex flex-row rounded-b-lg bg-[#F4F4F5] px-2 py-2 dark:bg-secondary	">
          <AlertCircle size={20} />
          <p className="text-sm font-semibold text-muted-foreground">
            Own your model configurations, use at your own risk.
            Misconfigurations may result in lower quality or unexpected outputs.{' '}
          </p>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

export default ImportingModelModal
