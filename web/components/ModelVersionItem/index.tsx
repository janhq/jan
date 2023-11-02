import React, { useMemo } from 'react'

import { atom, useAtomValue } from 'jotai'

import useDownloadModel from '@/hooks/useDownloadModel'

import { useGetDownloadedModels } from '@/hooks/useGetDownloadedModels'

import { formatDownloadPercentage, toGigabytes } from '@/utils/converter'

import SimpleTag from '../SimpleTag'
import { RamRequired, UsecaseTag } from '../SimpleTag/TagType'
import { ModelCatalog, ModelVersion } from '@janhq/core/lib/types'

import { modelDownloadStateAtom } from '@/helpers/atoms/DownloadState.atom'

type Props = {
  model: ModelCatalog
  modelVersion: ModelVersion
  isRecommended: boolean
}

const ModelVersionItem: React.FC<Props> = ({ model, modelVersion }) => {
  const { downloadModel } = useDownloadModel()
  const { downloadedModels } = useGetDownloadedModels()
  const isDownloaded =
    downloadedModels.find((model) => model._id === modelVersion._id) != null

  const downloadAtom = useMemo(
    () => atom((get) => get(modelDownloadStateAtom)[modelVersion._id ?? '']),
    [modelVersion._id]
  )
  const downloadState = useAtomValue(downloadAtom)

  const onDownloadClick = () => {
    downloadModel(model, modelVersion)
  }

  let downloadButton = (
    <button
      className="text-sm font-medium text-indigo-600"
      onClick={onDownloadClick}
    >
      Download
    </button>
  )

  if (downloadState) {
    downloadButton = (
      <div>{formatDownloadPercentage(downloadState.percent)}</div>
    )
  } else if (isDownloaded) {
    downloadButton = <div>Downloaded</div>
  }

  const { maxRamRequired, usecase } = modelVersion

  return (
    <div className="border-border flex items-center justify-between gap-4 border-t pb-3 pl-3 pr-4 pt-3 first:border-t-0">
      <div className="flex items-center gap-2">
        <span className="font-sm text-muted-foreground mb-4 line-clamp-1 flex-1">
          {modelVersion.name}
        </span>
      </div>
      <div className="flex items-center gap-4">
        <div className="flex justify-end gap-2">
          <SimpleTag
            title={usecase}
            type={UsecaseTag.UsecaseDefault}
            clickable={false}
          />
          <SimpleTag
            title={`${toGigabytes(maxRamRequired)} RAM required`}
            type={RamRequired.RamDefault}
            clickable={false}
          />
          <div className="border-border rounded-full border bg-background px-2.5 py-0.5 font-medium">
            {toGigabytes(modelVersion.size)}
          </div>
        </div>
        {downloadButton}
      </div>
    </div>
  )
}

export default ModelVersionItem
