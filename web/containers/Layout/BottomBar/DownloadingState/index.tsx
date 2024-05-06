import { Fragment } from 'react'

import { Progress, Modal, Button } from '@janhq/joi'

import { useAtomValue } from 'jotai'

import useDownloadModel from '@/hooks/useDownloadModel'
import { modelDownloadStateAtom } from '@/hooks/useDownloadState'

import { formatDownloadPercentage } from '@/utils/converter'

import { getDownloadingModelAtom } from '@/helpers/atoms/Model.atom'

export default function DownloadingState() {
  const downloadStates = useAtomValue(modelDownloadStateAtom)
  const downloadingModels = useAtomValue(getDownloadingModelAtom)
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
            <div className="relative block">
              <Button size="small" theme="ghost" variant="outline">
                <span>
                  {Object.values(downloadStates).length} Downloading model
                </span>
              </Button>
              <span
                className="absolute left-0 h-full rounded-md rounded-l-md bg-primary/20"
                style={{
                  width: `${totalPercentage}%`,
                }}
              />
            </div>
          }
          content={
            <div>
              {Object.values(downloadStates).map((item, i) => (
                <div className="pt-2" key={i}>
                  <Progress
                    className="mb-2 h-2"
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
                      theme="ghost"
                      variant="outline"
                      size="small"
                      onClick={() => {
                        if (item?.modelId) {
                          const model = downloadingModels.find(
                            (model) => model.id === item.modelId
                          )
                          if (model) abortModelDownload(model)
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
