import { useCallback } from 'react'
import { useDropzone } from 'react-dropzone'

import { SelectFileOption, systemInformation } from '@janhq/core'
import { Modal } from '@janhq/joi'
import { useAtomValue, useSetAtom } from 'jotai'

import { UploadCloudIcon } from 'lucide-react'

import useDropModelBinaries from '@/hooks/useDropModelBinaries'
import useImportModel, {
  getImportModelStageAtom,
  setImportModelStageAtom,
} from '@/hooks/useImportModel'

const SelectingModelModal = () => {
  const setImportModelStage = useSetAtom(setImportModelStageAtom)
  const importModelStage = useAtomValue(getImportModelStageAtom)
  const { onDropModels } = useDropModelBinaries()
  const { sanitizeFilePaths } = useImportModel()

  const onSelectFileClick = useCallback(async () => {
    const platform = (await systemInformation()).osInfo?.platform
    if (platform !== 'darwin') {
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

  const borderColor = isDragActive
    ? 'border-[hsla(var(--primary-bg))]'
    : 'border-[hsla(var(--app-border))]'
  const textColor = isDragActive
    ? 'text-[hsla(var(--primary-bg)]'
    : 'text-[hsla(var(--text-secondary))]'
  const dragAndDropBgColor = isDragActive && 'bg-[hsla(var(--primary-bg-soft))]'

  return (
    <Modal
      open={importModelStage === 'SELECTING_MODEL'}
      onOpenChange={() => {
        setImportModelStage('NONE')
      }}
      title="Import Model"
      content={
        <div>
          <p className="font-medium text-[hsla(var(--text-secondary))]">
            Import any model file (GGUF) or folder. Your imported model will be
            private to you.
          </p>
          <div
            className={`mt-4 flex h-[172px] w-full cursor-pointer items-center justify-center rounded-md border ${borderColor} ${dragAndDropBgColor}`}
            {...getRootProps()}
            onClick={onSelectFileClick}
          >
            <div className="flex flex-col items-center justify-center">
              <div className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-full">
                <UploadCloudIcon
                  size={24}
                  className="text-[hsla(var(--primary-bg))]"
                />
              </div>
              <div className="mt-4">
                <span className="text-primary font-bold">
                  Click to upload &nbsp;
                </span>
                <span className={`${textColor} font-medium`}>
                  or drag and drop (GGUF)
                </span>
              </div>
            </div>
          </div>
        </div>
      }
    />
  )
}

export default SelectingModelModal
