import { useCallback } from 'react'

import { Model } from '@janhq/core'

import { Modal, Button, ModalClose } from '@janhq/joi'

import useCortex from '@/hooks/useCortex'

import { formatDownloadPercentage } from '@/utils/converter'

type Props = {
  model: Model
}

const ModalCancelDownload: React.FC<Props> = ({ model }) => {
  const { abortDownload } = useCortex()
  const cancelText = `Cancel ${formatDownloadPercentage(0)}`

  const onAbortDownloadClick = useCallback(() => {
    abortDownload(model.id)
  }, [abortDownload, model.id])

  return (
    <Modal
      title="Cancel Download"
      trigger={
        <Button variant="soft">
          <div className="flex items-center space-x-2">
            <span className="inline-block">Cancel</span>
            {/* <Progress
                className="w-[80px]"
                value={
                  formatDownloadPercentage(downloadState?.percent, {
                    hidePercentage: true,
                  }) as number
                }
              /> */}
            <span className="tabular-nums">
              {/* {formatDownloadPercentage(downloadState.percent)} */}
            </span>
          </div>
        </Button>
      }
      content={
        <div>
          <p className="text-[hsla(var(--text-secondary))]">
            Are you sure you want to cancel the download of&nbsp;
            <span className="font-medium text-[hsla(var(--text-primary))]">
              {/* {downloadState?.modelId}? */}
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
