import { useCallback } from 'react'

import { ImportingModel, SelectFileOption } from '@janhq/core'
import { Button, Modal } from '@janhq/joi'
import { useSetAtom, useAtomValue } from 'jotai'

import { snackbar } from '@/containers/Toast'

import {
  setImportModelStageAtom,
  getImportModelStageAtom,
} from '@/hooks/useImportModel'

import { importingModelsAtom } from '@/helpers/atoms/Model.atom'

const ChooseWhatToImportModal = () => {
  const setImportModelStage = useSetAtom(setImportModelStageAtom)
  const setImportingModels = useSetAtom(importingModelsAtom)
  const importModelStage = useAtomValue(getImportModelStageAtom)

  const onImportFileClick = useCallback(async () => {
    const options: SelectFileOption = {
      title: 'Select model files',
      buttonLabel: 'Select',
      allowMultiple: true,
      filters: [
        { name: 'GGUF Files', extensions: ['gguf'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    }
    const filePaths: string[] = await window.core?.api?.selectFiles(options)
    if (!filePaths || filePaths.length === 0) return

    const importingModels: ImportingModel[] = filePaths
      .filter((path) => path.endsWith('.gguf'))
      .map((path) => {
        const normalizedPath = isWindows ? path.replace(/\\/g, '/') : path

        return {
          importId: normalizedPath,
          modelId: undefined,
          name: normalizedPath.replace('.gguf', ''),
          description: '',
          path: path,
          tags: [],
          size: 0,
          status: 'PREPARING',
          format: 'gguf',
        }
      })
    if (importingModels.length < 1) {
      snackbar({
        description: `Only files with .gguf extension can be imported.`,
        type: 'error',
      })
      return
    }
    setImportingModels(importingModels)
    setImportModelStage('MODEL_SELECTED')
  }, [setImportingModels, setImportModelStage])

  const onImportFolderClick = useCallback(async () => {
    const options: SelectFileOption = {
      title: 'Select model folders',
      buttonLabel: 'Select',
      allowMultiple: true,
      selectDirectory: true,
    }
    const filePaths: string[] = await window.core?.api?.selectFiles(options)
    if (!filePaths || filePaths.length === 0) return

    console.log('filePaths folder', filePaths)
    const importingModels: ImportingModel[] = filePaths
      .filter((path) => path.endsWith('.gguf'))
      .map((path) => {
        const normalizedPath = isWindows ? path.replace(/\\/g, '/') : path

        return {
          importId: normalizedPath,
          modelId: undefined,
          name: normalizedPath.replace('.gguf', ''),
          description: '',
          path: path,
          tags: [],
          size: 0,
          status: 'PREPARING',
          format: 'gguf',
        }
      })
    if (importingModels.length < 1) {
      snackbar({
        description: `Only files with .gguf extension can be imported.`,
        type: 'error',
      })
      return
    }
    setImportingModels(importingModels)
    setImportModelStage('MODEL_SELECTED')
  }, [setImportingModels, setImportModelStage])

  return (
    <Modal
      title="Choose what to import"
      open={importModelStage === 'CHOOSE_WHAT_TO_IMPORT'}
      onOpenChange={() => setImportModelStage('SELECTING_MODEL')}
      content={
        <div>
          <div className="mt-2 flex flex-col space-y-3">
            <Button onClick={onImportFileClick}>Import file (GGUF)</Button>
            <Button onClick={onImportFolderClick}>Import Folder</Button>
          </div>
        </div>
      }
    />
  )
}

export default ChooseWhatToImportModal
