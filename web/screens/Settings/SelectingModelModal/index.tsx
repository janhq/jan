import { useCallback } from 'react'
import { useDropzone } from 'react-dropzone'

import { SelectFileOption, systemInformation } from '@janhq/core'
import { Modal, ModalContent, ModalHeader, ModalTitle } from '@janhq/uikit'
import { useAtomValue, useSetAtom } from 'jotai'

import { UploadCloudIcon } from 'lucide-react'

import useDropModelBinaries from '@/hooks/useDropModelBinaries'
import useImportModel, {
  getImportModelStageAtom,
  setImportModelStageAtom,
} from '@/hooks/useImportModel'

const SelectingModelModal: React.FC = () => {
  const setImportModelStage = useSetAtom(setImportModelStageAtom)
  const importModelStage = useAtomValue(getImportModelStageAtom)
  const { onDropModels } = useDropModelBinaries()
  const { sanitizeFilePaths } = useImportModel()

  const onSelectFileClick = useCallback(async () => {
    const platform = (await systemInformation()).osInfo?.platform
    if (platform === 'win32') {
      setImportModelStage('CHOOSE_WHAT_TO_IMPORT')
      return
    }
    const options: SelectFileOption = {
      title: 'Select model folders',
      buttonLabel: 'Select',
      allowMultiple: true,
      selectDirectory: true,
    }
    const filePaths = await window.core?.api?.selectFiles(options)
    if (!filePaths || filePaths.length === 0) return
    sanitizeFilePaths(filePaths)
  }, [sanitizeFilePaths, setImportModelStage])

  const { isDragActive, getRootProps } = useDropzone({
    noClick: true,
    multiple: true,
    onDrop: onDropModels,
  })

  const borderColor = isDragActive ? 'border-primary' : 'border-border'
  const textColor = isDragActive ? 'text-primary' : 'text-muted-foreground'
  const dragAndDropBgColor = isDragActive
    ? 'bg-[#EFF6FF] dark:bg-blue-50/10'
    : 'bg-background'

  return (
    <Modal
      open={importModelStage === 'SELECTING_MODEL'}
      onOpenChange={() => {
        setImportModelStage('NONE')
      }}
    >
      <ModalContent>
        <ModalHeader>
          <ModalTitle>Import Model</ModalTitle>

          <p className="text-sm font-medium text-muted-foreground">
            Import any model file (GGUF) or folder. Your imported model will be
            private to you.
          </p>
        </ModalHeader>

        <div
          className={`flex h-[172px] w-full items-center justify-center rounded-md border ${borderColor} ${dragAndDropBgColor}`}
          {...getRootProps()}
          onClick={onSelectFileClick}
        >
          <div className="flex flex-col items-center justify-center">
            <div className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-full bg-blue-200">
              <UploadCloudIcon size={24} className="text-blue-600" />
            </div>

            <div className="mt-4">
              <span className="text-sm font-bold text-primary">
                Click to upload
              </span>
              <span className={`text-sm ${textColor} font-medium`}>
                {' '}
                or drag and drop
              </span>
            </div>
            <span className={`text-xs font-medium ${textColor}`}>(GGUF)</span>
          </div>
        </div>
      </ModalContent>
    </Modal>
  )
}

export default SelectingModelModal
