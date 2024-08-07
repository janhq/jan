import { Fragment } from 'react'

import { DownloadItem } from '@janhq/core'
import { Progress, Modal, Button } from '@janhq/joi'
import { useAtomValue } from 'jotai'

import useAbortDownload from '@/hooks/useAbortDownload'
import { downloadStateListAtom } from '@/hooks/useDownloadState'

import { formatDownloadPercentage } from '@/utils/converter'

const DownloadStatus: React.FC = () => {
  const downloadStates = useAtomValue(downloadStateListAtom)
  const { abortDownload } = useAbortDownload()

  const totalTransfferedSize = downloadStates.reduce(
    (partialSum: number, state) =>
      partialSum +
      state.children.reduce(
        (partialSum: number, downloadItem: DownloadItem) =>
          partialSum + downloadItem.size.transferred,
        0
      ),
    0
  )

  const totalDownloadSize = downloadStates.reduce(
    (partialSum: number, state) =>
      partialSum +
      state.children.reduce(
        (partialSum: number, downloadItem: DownloadItem) =>
          partialSum + downloadItem.size.total,
        0
      ),
    0
  )

  const totalPercentage =
    totalDownloadSize !== 0
      ? ((totalTransfferedSize / totalDownloadSize) * 100).toFixed(2)
      : 0

  const downloadTitle = `Downloading ${downloadStates
    .map((state) => state.type)
    .filter((value, index, self) => self.indexOf(value) === index)
    .join(', ')
    .trim()}`

  return (
    <Fragment>
      {Object.values(downloadStates)?.length > 0 && (
        <Modal
          title={downloadTitle}
          trigger={
            <div className="flex cursor-pointer items-center gap-2">
              <Button size="small" theme="ghost">
                <span className="font-medium">
                  {downloadTitle}{' '}
                  {Object.values(downloadStates).length > 1 &&
                    `1/${Object.values(downloadStates).length}`}
                </span>
              </Button>
              <Progress
                size="small"
                className="w-20"
                value={Number(totalPercentage)}
              />
              <div className="text-xs font-semibold text-[hsla(var(--primary-bg))]">
                {totalPercentage}%
              </div>
            </div>
          }
          content={
            <div>
              {Object.values(downloadStates).map((item, i) => {
                // TODO: move this to another component
                const transferred = item.children.reduce(
                  (sum: number, downloadItem: DownloadItem) =>
                    sum + downloadItem.size.transferred,
                  0
                )
                const total = item.children.reduce(
                  (sum: number, downloadItem: DownloadItem) =>
                    sum + downloadItem.size.total,
                  0
                )

                return (
                  <div className="mt-3 pt-2" key={i}>
                    <Progress
                      className="mb-3"
                      value={
                        formatDownloadPercentage(transferred / total, {
                          hidePercentage: true,
                        }) as number
                      }
                    />
                    <div className="flex items-center justify-between gap-x-2">
                      <div className="flex gap-x-2">
                        <p className="line-clamp-1 text-[hsla(var(--text-secondary))]">
                          {item.title}
                        </p>
                        <span className="font-medium text-[hsla(var(--primary-bg))]">
                          {formatDownloadPercentage(transferred / total)}
                        </span>
                      </div>
                      <Button
                        theme="destructive"
                        onClick={() => abortDownload(item.id)}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          }
        />
      )}
    </Fragment>
  )
}

export default DownloadStatus
