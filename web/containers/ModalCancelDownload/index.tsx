import { useCallback } from 'react'

import { Modal, Button, Progress, ModalClose } from '@janhq/joi'

import { useAtomValue, useSetAtom } from 'jotai'

import useDownloadModel from '@/hooks/useDownloadModel'

import {
  modelDownloadStateAtom,
  removeDownloadStateAtom,
} from '@/hooks/useDownloadState'

import { formatDownloadPercentage } from '@/utils/converter'

type Props = {
  modelId: string
  isFromList?: boolean
}

const ModalCancelDownload = ({ modelId, isFromList }: Props) => {
  const { abortModelDownload } = useDownloadModel()
  const removeDownloadState = useSetAtom(removeDownloadStateAtom)
  const allDownloadStates = useAtomValue(modelDownloadStateAtom)
  const downloadState = allDownloadStates[modelId]

  const cancelText = `Cancel ${formatDownloadPercentage(downloadState?.percent ?? 0)}`

  const onAbortDownloadClick = useCallback(() => {
    removeDownloadState(modelId)
    abortModelDownload(downloadState?.modelId ?? modelId)
  }, [downloadState, abortModelDownload, removeDownloadState, modelId])

  return (
    <Modal
      title="Cancel Download"
      trigger={
        isFromList ? (
          <Button variant="outline" size="small">
            {cancelText}
          </Button>
        ) : (
          <Button
            className="text-[hsla(var(--primary-bg))]"
            variant="soft"
            theme="ghost"
          >
            <div className="flex items-center space-x-2">
              <span className="inline-block">Cancel</span>
              <Progress
                className="w-[80px]"
                value={
                  formatDownloadPercentage(downloadState?.percent ?? 0, {
                    hidePercentage: true,
                  }) as number
                }
              />
              <span className="tabular-nums">
                {formatDownloadPercentage(downloadState?.percent ?? 0)}
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
