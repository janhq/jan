/* eslint-disable react-hooks/exhaustive-deps */
import React, { useMemo } from 'react'

import { ModelCatalog, ModelVersion } from '@janhq/core/lib/types'
import { Button, Badge } from '@janhq/uikit'

import { atom, useAtomValue } from 'jotai'

import ModalCancelDownload from '@/containers/ModalCancelDownload'

import { MainViewState } from '@/constants/screens'

import useDownloadModel from '@/hooks/useDownloadModel'
import { useDownloadState } from '@/hooks/useDownloadState'
import { useGetDownloadedModels } from '@/hooks/useGetDownloadedModels'
import { useMainViewState } from '@/hooks/useMainViewState'

import { toGigabytes } from '@/utils/converter'

type Props = {
  model: ModelCatalog
  modelVersion: ModelVersion
  isRecommended: boolean
}

const ModelVersionItem: React.FC<Props> = ({ model, modelVersion }) => {
  const { downloadModel } = useDownloadModel()
  const { downloadedModels } = useGetDownloadedModels()
  const { setMainViewState } = useMainViewState()
  const isDownloaded =
    downloadedModels.find((model) => model.id === modelVersion.name) != null

  const { modelDownloadStateAtom, downloadStates } = useDownloadState()

  const downloadAtom = useMemo(
    () => atom((get) => get(modelDownloadStateAtom)[modelVersion.name ?? '']),
    [modelVersion.name]
  )
  const downloadState = useAtomValue(downloadAtom)

  const onDownloadClick = () => {
    downloadModel(model, modelVersion)
  }

  let downloadButton = (
    <Button themes="outline" size="sm" onClick={() => onDownloadClick()}>
      Download
    </Button>
  )

  if (isDownloaded) {
    downloadButton = (
      <Button
        themes="outline"
        size="sm"
        onClick={() => {
          setMainViewState(MainViewState.MyModels)
        }}
      >
        View Downloaded Model
      </Button>
    )
  }

  if (downloadState != null && downloadStates.length > 0) {
    downloadButton = (
      <ModalCancelDownload suitableModel={modelVersion} isFromList />
    )
  }

  const { maxRamRequired, usecase } = modelVersion

  return (
    <div className="flex items-center justify-between gap-4 border-t border-border pb-3 pl-3 pr-4 pt-3 first:border-t-0">
      <div className="flex items-center gap-2">
        <span className="line-clamp-1 flex-1" title={modelVersion.name}>
          {modelVersion.name}
        </span>
      </div>
      <div className="flex items-center gap-4">
        <div className="flex justify-end gap-2">
          <Badge
            themes="secondary"
            className="line-clamp-1 max-w-[240px] lg:line-clamp-none lg:max-w-none"
            title={usecase}
          >
            {usecase}
          </Badge>

          <Badge
            themes="secondary"
            className="line-clamp-1"
            title={`${toGigabytes(maxRamRequired)} RAM required`}
          >{`${toGigabytes(maxRamRequired)} RAM required`}</Badge>
          <Badge themes="secondary">{toGigabytes(modelVersion.size)}</Badge>
        </div>
        {downloadButton}
      </div>
    </div>
  )
}

export default ModelVersionItem
