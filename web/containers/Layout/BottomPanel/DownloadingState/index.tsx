import { Fragment } from 'react'

import { Progress, Modal, Button } from '@janhq/joi'

import { useAtomValue } from 'jotai'

import useDownloadModel from '@/hooks/useDownloadModel'
import { modelDownloadStateAtom } from '@/hooks/useDownloadState'

import { formatDownloadPercentage } from '@/utils/converter'

export default function DownloadingState() {
  const downloadStates = useAtomValue(modelDownloadStateAtom)
  const { abortModelDownload } = useDownloadModel()

  const totalCurrentProgress = Object.values(downloadStates)
    .map((a) => a.size.transferred + a.size.transferred)
    .reduce((partialSum, a) => partialSum + a, 0)

  const totalSize = Object.values(downloadStates)
    .map((a) => a.size.total + a.size.total)
    .reduce((partialSum, a) => partialSum + a, 0)

  const totalPercentage =
    totalSize !== 0 ? ((totalCurrentProgress / totalSize) * 100).toFixed(2) : 0

  return (
    <Fragment>
      {Object.values(downloadStates)?.length > 0 && (
        <Modal
          title="Downloading model"
          trigger={
            <div className="flex cursor-pointer items-center gap-2">
              <Button size="small" theme="ghost">
                <span className="font-medium">
                  Downloading model{' '}
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
              {Object.values(downloadStates).map((item, i) => (
                <div className="mt-3 pt-2" key={i}>
                  <Progress
                    className="mb-3"
                    value={
                      formatDownloadPercentage(item?.percent, {
                        hidePercentage: true,
                      }) as number
                    }
                  />
                  <div className="flex items-center justify-between gap-x-2">
                    <div className="flex gap-x-2">
                      <p className="line-clamp-1 text-[hsla(var(--text-secondary))]">
                        {item?.modelId}
                      </p>
                      <span className="font-medium text-[hsla(var(--primary-bg))]">
                        {formatDownloadPercentage(item?.percent)}
                      </span>
                    </div>
                    <Button
                      theme="destructive"
                      onClick={() => {
                        if (item?.modelId) {
                          abortModelDownload(item?.modelId)
                        }
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          }
        />
      )}
    </Fragment>
  )
}
