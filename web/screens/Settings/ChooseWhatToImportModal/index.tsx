import { useCallback } from 'react'

import { SelectFileOption } from '@janhq/core'
import { Button, Modal } from '@janhq/joi'
import { useSetAtom, useAtomValue } from 'jotai'

import useImportModel, {
  setImportModelStageAtom,
  getImportModelStageAtom,
} from '@/hooks/useImportModel'

const ChooseWhatToImportModal: React.FC = () => {
  const setImportModelStage = useSetAtom(setImportModelStageAtom)
  const importModelStage = useAtomValue(getImportModelStageAtom)
  const { sanitizeFilePaths } = useImportModel()

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
    const filePaths = await window.core?.api?.selectFiles(options)
    if (!filePaths || filePaths.length === 0) return
    sanitizeFilePaths(filePaths)
  }, [sanitizeFilePaths])

  const onImportFolderClick = useCallback(async () => {
    const options: SelectFileOption = {
      title: 'Select model folders',
      buttonLabel: 'Select',
      allowMultiple: true,
      selectDirectory: true,
    }
    const filePaths = await window.core?.api?.selectFiles(options)
    if (!filePaths || filePaths.length === 0) return
    sanitizeFilePaths(filePaths)
  }, [sanitizeFilePaths])

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
