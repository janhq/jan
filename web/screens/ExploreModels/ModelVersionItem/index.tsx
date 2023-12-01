/* eslint-disable react-hooks/exhaustive-deps */
import React, { useMemo } from 'react'

import { Model } from '@janhq/core'
import { Badge, Button } from '@janhq/uikit'
import { atom, useAtomValue } from 'jotai'

import ModalCancelDownload from '@/containers/ModalCancelDownload'

import { MainViewState } from '@/constants/screens'

import useDownloadModel from '@/hooks/useDownloadModel'
import { useDownloadState } from '@/hooks/useDownloadState'
import { useGetDownloadedModels } from '@/hooks/useGetDownloadedModels'
import { useMainViewState } from '@/hooks/useMainViewState'

import { toGigabytes } from '@/utils/converter'

type Props = {
  model: Model
  isRecommended: boolean
}

const ModelVersionItem: React.FC<Props> = ({ model }) => {
  const { downloadModel } = useDownloadModel()
  const { downloadedModels } = useGetDownloadedModels()
  const { setMainViewState } = useMainViewState()
  const isDownloaded =
    downloadedModels.find(
      (downloadedModel) => downloadedModel.id === model.id
    ) != null

  const { modelDownloadStateAtom, downloadStates } = useDownloadState()

  const downloadAtom = useMemo(
    () => atom((get) => get(modelDownloadStateAtom)[model.id ?? '']),
    [model.id]
  )
  const downloadState = useAtomValue(downloadAtom)

  const onDownloadClick = () => {
    downloadModel(model)
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
    downloadButton = <ModalCancelDownload suitableModel={model} isFromList />
  }

  return (
    <div className="flex items-center justify-between gap-4 border-t border-border pb-3 pl-3 pr-4 pt-3 first:border-t-0">
      <div className="flex items-center gap-2">
        <span className="line-clamp-1 flex-1" title={model.name}>
          {model.name}
        </span>
      </div>
      <div className="flex items-center gap-4">
        <div className="flex justify-end gap-2">
          <Badge
            themes="secondary"
            className="line-clamp-1"
            title={`${toGigabytes(model.metadata.maxRamRequired)} RAM required`}
          >{`${toGigabytes(
            model.metadata.maxRamRequired
          )} RAM required`}</Badge>
          <Badge themes="secondary">{toGigabytes(model.metadata.size)}</Badge>
        </div>
        {downloadButton}
      </div>
    </div>
  )
}

export default ModelVersionItem
