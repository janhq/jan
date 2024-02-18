import { useCallback } from 'react'

import { Model } from '@janhq/core'

import {
  Modal,
  ModalTrigger,
  ModalClose,
  ModalFooter,
  ModalContent,
  ModalHeader,
  Button,
  ModalTitle,
  Progress,
} from '@janhq/uikit'

import { useAtomValue } from 'jotai'

import useDownloadModel from '@/hooks/useDownloadModel'

import { modelDownloadStateAtom } from '@/hooks/useDownloadState'

import { formatDownloadPercentage } from '@/utils/converter'

import { getDownloadingModelAtom } from '@/helpers/atoms/Model.atom'

type Props = {
  model: Model
  isFromList?: boolean
}

const ModalCancelDownload: React.FC<Props> = ({ model, isFromList }) => {
  const { abortModelDownload } = useDownloadModel()
  const downloadingModels = useAtomValue(getDownloadingModelAtom)
  const allDownloadStates = useAtomValue(modelDownloadStateAtom)
  const downloadState = allDownloadStates[model.id]

  const cancelText = `Cancel ${formatDownloadPercentage(downloadState.percent)}`

  const onAbortDownloadClick = useCallback(() => {
    if (downloadState?.modelId) {
      const model = downloadingModels.find(
        (model) => model.id === downloadState.modelId
      )
      if (model) abortModelDownload(model)
    }
  }, [downloadState, downloadingModels, abortModelDownload])

  return (
    <Modal>
      <ModalTrigger asChild>
        {isFromList ? (
          <Button themes="outline" size="sm">
            {cancelText}
          </Button>
        ) : (
          <Button themes="secondaryBlue">
            <div className="flex items-center space-x-2">
              <span className="inline-block">Cancel</span>
              <Progress
                className="inline-block h-2 w-[80px] bg-blue-100"
                value={
                  formatDownloadPercentage(downloadState?.percent, {
                    hidePercentage: true,
                  }) as number
                }
              />
              <span>{formatDownloadPercentage(downloadState.percent)}</span>
            </div>
          </Button>
        )}
      </ModalTrigger>
      <ModalContent>
        <ModalHeader>
          <ModalTitle>Cancel Download</ModalTitle>
        </ModalHeader>
        <p>
          Are you sure you want to cancel the download of&nbsp;
          {downloadState?.modelId}?
        </p>
        <ModalFooter>
          <div className="flex gap-x-2">
            <ModalClose asChild>
              <Button themes="ghost">No</Button>
            </ModalClose>
            <ModalClose asChild>
              <Button themes="danger" onClick={onAbortDownloadClick}>
                Yes
              </Button>
            </ModalClose>
          </div>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

export default ModalCancelDownload
