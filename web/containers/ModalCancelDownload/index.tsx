import { useMemo } from 'react'

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

import { atom, useAtomValue } from 'jotai'

import useDownloadModel from '@/hooks/useDownloadModel'
import { useDownloadState } from '@/hooks/useDownloadState'

import { formatDownloadPercentage } from '@/utils/converter'

import { downloadingModelsAtom } from '@/helpers/atoms/Model.atom'

type Props = {
  model: Model
  isFromList?: boolean
}

export default function ModalCancelDownload({ model, isFromList }: Props) {
  const { modelDownloadStateAtom } = useDownloadState()
  const downloadingModels = useAtomValue(downloadingModelsAtom)
  const downloadAtom = useMemo(
    () => atom((get) => get(modelDownloadStateAtom)[model.id]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [model.id]
  )
  const downloadState = useAtomValue(downloadAtom)
  const cancelText = `Cancel ${formatDownloadPercentage(downloadState.percent)}`
  const { abortModelDownload } = useDownloadModel()

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
              <Button
                themes="danger"
                onClick={() => {
                  if (downloadState?.modelId) {
                    const model = downloadingModels.find(
                      (model) => model.id === downloadState.modelId
                    )
                    if (model) abortModelDownload(model)
                  }
                }}
              >
                Yes
              </Button>
            </ModalClose>
          </div>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
