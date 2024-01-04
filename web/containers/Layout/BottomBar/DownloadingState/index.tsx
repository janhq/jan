import { Fragment } from 'react'

import { ExtensionType } from '@janhq/core'
import { ModelExtension } from '@janhq/core'
import {
  Progress,
  Modal,
  ModalContent,
  Button,
  ModalHeader,
  ModalTitle,
  ModalTrigger,
} from '@janhq/uikit'

import { useDownloadState } from '@/hooks/useDownloadState'

import { formatDownloadPercentage } from '@/utils/converter'

import { extensionManager } from '@/extension'

export default function DownloadingState() {
  const { downloadStates } = useDownloadState()

  const totalCurrentProgress = downloadStates
    .map((a) => a.size.transferred + a.size.transferred)
    .reduce((partialSum, a) => partialSum + a, 0)

  const totalSize = downloadStates
    .map((a) => a.size.total + a.size.total)
    .reduce((partialSum, a) => partialSum + a, 0)

  const totalPercentage = ((totalCurrentProgress / totalSize) * 100).toFixed(2)

  return (
    <Fragment>
      {downloadStates?.length > 0 && (
        <Modal>
          <ModalTrigger asChild>
            <div className="relative block">
              <Button size="sm" themes="outline">
                <span>{downloadStates.length} Downloading model</span>
              </Button>
              <span
                className="absolute left-0 h-full rounded-md rounded-l-md bg-primary/20"
                style={{
                  width: `${totalPercentage}%`,
                }}
              />
            </div>
          </ModalTrigger>
          <ModalContent>
            <ModalHeader>
              <ModalTitle>Downloading model</ModalTitle>
            </ModalHeader>
            {downloadStates.map((item, i) => {
              return (
                <div className="pt-2" key={i}>
                  <Progress
                    className="inline-block h-2 w-[80px] bg-blue-100"
                    value={
                      formatDownloadPercentage(item?.percent, {
                        hidePercentage: true,
                      }) as number
                    }
                  />
                  <div className="flex items-center justify-between gap-x-2">
                    <div className="flex gap-x-2">
                      <p className="line-clamp-1">{item?.modelId}</p>
                      <span>{formatDownloadPercentage(item?.percent)}</span>
                    </div>
                    <Button
                      themes="outline"
                      size="sm"
                      onClick={() => {
                        if (item?.modelId) {
                          extensionManager
                            .get<ModelExtension>(ExtensionType.Model)
                            ?.cancelModelDownload(item.modelId)
                        }
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )
            })}
          </ModalContent>
        </Modal>
      )}
    </Fragment>
  )
}
