import { useCallback } from 'react'

import { SelectFileOption } from '@janhq/core'
import {
  Button,
  Modal,
  ModalContent,
  ModalHeader,
  ModalTitle,
} from '@janhq/uikit'
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
      open={importModelStage === 'CHOOSE_WHAT_TO_IMPORT'}
      onOpenChange={() => setImportModelStage('SELECTING_MODEL')}
    >
      <ModalContent>
        <ModalHeader>
          <ModalTitle>Choose what to import</ModalTitle>
        </ModalHeader>

        <div>
          <Button onClick={onImportFileClick}>Import file (GGUF)</Button>
          <Button onClick={onImportFolderClick}>Import Folder</Button>
        </div>
      </ModalContent>
    </Modal>
  )
}

export default ChooseWhatToImportModal
