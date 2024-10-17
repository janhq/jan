import { useCallback } from 'react'

import { Model } from '@janhq/core'

import { Modal, Button, Progress, ModalClose } from '@janhq/joi'

import { useAtomValue } from 'jotai'

import useDownloadModel from '@/hooks/useDownloadModel'

import { modelDownloadStateAtom } from '@/hooks/useDownloadState'

import { formatDownloadPercentage } from '@/utils/converter'

import { getDownloadingModelAtom } from '@/helpers/atoms/Model.atom'

type Props = {
  model: Model
  isFromList?: boolean
}

const ModalCancelDownload = ({ model, isFromList }: Props) => {
  const { abortModelDownload } = useDownloadModel()
  const downloadingModels = useAtomValue(getDownloadingModelAtom)
  const allDownloadStates = useAtomValue(modelDownloadStateAtom)
  const downloadState = allDownloadStates[model.id]

  const cancelText = `Cancel ${formatDownloadPercentage(downloadState.percent)}`

  const onAbortDownloadClick = useCallback(() => {
    if (downloadState?.modelId) {
      const model = downloadingModels.find(
        (model) => model === downloadState.modelId
      )
      if (model) abortModelDownload(model)
    }
  }, [downloadState, downloadingModels, abortModelDownload])

  return (
    <Modal
      title="Cancel Download"
      trigger={
        isFromList ? (
          <Button variant="outline" size="small">
            {cancelText}
          </Button>
        ) : (
          <Button variant="soft">
            <div className="flex items-center space-x-2">
              <span className="inline-block">Cancel</span>
              <Progress
                className="w-[80px]"
                value={
                  formatDownloadPercentage(downloadState?.percent, {
                    hidePercentage: true,
                  }) as number
                }
              />
              <span className="tabular-nums">
                {formatDownloadPercentage(downloadState.percent)}
              </span>
            </div>
          </Button>
        )
      }
      content={
        <div>
          <p className="text-[hsla(var(--text-secondary))]">
            Are you sure you want to cancel the download of&nbsp;
            <span className="font-medium text-[hsla(var(--text-primary))]">
              {downloadState?.modelId}?
            </span>
          </p>
          <div className="mt-4 flex justify-end gap-x-2">
            <ModalClose asChild>
              <Button theme="ghost">No</Button>
            </ModalClose>
            <ModalClose asChild>
              <Button theme="destructive" onClick={onAbortDownloadClick}>
                Yes
              </Button>
            </ModalClose>
          </div>
        </div>
      }
    />
  )
}

export default ModalCancelDownload
