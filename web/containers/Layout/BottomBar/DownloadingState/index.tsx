import { Fragment } from 'react'

import {
  Progress,
  Modal,
  ModalContent,
  Button,
  ModalHeader,
  ModalTitle,
  ModalTrigger,
} from '@janhq/uikit'

import SystemItem from '@/containers/Layout/BottomBar/SystemItem'

import { useDownloadState } from '@/hooks/useDownloadState'

import { formatDownloadPercentage } from '@/utils/converter'

export default function DownloadingState() {
  const { downloadStates } = useDownloadState()

  return (
    <Fragment>
      {downloadStates.length === 1 && (
        <Fragment>
          <div className="flex w-[50px] items-center gap-x-2">
            <Progress
              className="h-2"
              value={
                formatDownloadPercentage(downloadStates[0]?.percent, {
                  hidePercentage: true,
                }) as number
              }
            />
          </div>
          <SystemItem
            name="Downloading"
            value={`${downloadStates[0]?.fileName}: ${formatDownloadPercentage(
              downloadStates[0]?.percent
            )}`}
          />
        </Fragment>
      )}

      {downloadStates?.length > 1 && (
        <Modal>
          <ModalTrigger asChild>
            <Button size="sm" themes="outline">
              <span>{downloadStates.length} Downloading model</span>
            </Button>
          </ModalTrigger>
          <ModalContent>
            <ModalHeader>
              <ModalTitle>Downloading model</ModalTitle>
            </ModalHeader>
            {downloadStates.map((item, i) => {
              return (
                <div className="pt-2" key={i}>
                  <Progress
                    className="mb-2 h-2"
                    value={
                      formatDownloadPercentage(item?.percent, {
                        hidePercentage: true,
                      }) as number
                    }
                  />
                  <div className="flex items-center justify-between">
                    <p>{item?.fileName}</p>
                    <span>{formatDownloadPercentage(item?.percent)}</span>
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
