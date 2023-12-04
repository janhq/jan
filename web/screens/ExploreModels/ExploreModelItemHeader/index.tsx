/* eslint-disable react-hooks/exhaustive-deps */
import { useCallback, useMemo, useState } from 'react'

import { Model } from '@janhq/core'
import { Badge, Button } from '@janhq/uikit'

import { atom, useAtomValue } from 'jotai'

import ModalCancelDownload from '@/containers/ModalCancelDownload'

import { MainViewState } from '@/constants/screens'

import { ModelPerformance, TagType } from '@/constants/tagType'

import useDownloadModel from '@/hooks/useDownloadModel'
import { useDownloadState } from '@/hooks/useDownloadState'
import { useGetDownloadedModels } from '@/hooks/useGetDownloadedModels'
import { useMainViewState } from '@/hooks/useMainViewState'

import { toGigabytes } from '@/utils/converter'

type Props = {
  model: Model
}

const ExploreModelItemHeader: React.FC<Props> = ({ model }) => {
  console.log(model)
  const { downloadModel } = useDownloadModel()
  const { downloadedModels } = useGetDownloadedModels()
  const { modelDownloadStateAtom, downloadStates } = useDownloadState()
  const [title, setTitle] = useState<string>('Recommended')

  const [performanceTag, setPerformanceTag] = useState<TagType>(
    ModelPerformance.PerformancePositive
  )
  const downloadAtom = useMemo(
    () => atom((get) => get(modelDownloadStateAtom)[model.id]),
    [model.id]
  )
  const downloadState = useAtomValue(downloadAtom)
  const { setMainViewState } = useMainViewState()

  const onDownloadClick = useCallback(() => {
    downloadModel(model)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model])

  const isDownloaded = downloadedModels.find((md) => md.id === model.id) != null

  let downloadButton = (
    <Button onClick={() => onDownloadClick()}>
      {model.metadata.size
        ? `Download (${toGigabytes(model.metadata.size)})`
        : 'Download'}
    </Button>
  )

  if (isDownloaded) {
    downloadButton = (
      <Button
        themes="success"
        className="min-w-[80px]"
        onClick={() => {
          setMainViewState(MainViewState.MyModels)
        }}
      >
        Use
      </Button>
    )
  }

  if (downloadState != null && downloadStates.length > 0) {
    downloadButton = <ModalCancelDownload model={model} />
  }

  const renderBadge = (performance: TagType) => {
    switch (performance) {
      case ModelPerformance.PerformancePositive:
        return <Badge themes="success">{title}</Badge>

      case ModelPerformance.PerformanceNeutral:
        return <Badge themes="secondary">{title}</Badge>

      case ModelPerformance.PerformanceNegative:
        return <Badge themes="danger">{title}</Badge>

      default:
        break
    }
  }

  return (
    <div className="flex items-center justify-between rounded-t-md border-b border-border bg-background/50 px-4 py-2">
      <div className="flex items-center gap-2">
        <span className="font-medium">{model.name}</span>
      </div>
      <div className="space-x-2">
        {performanceTag && renderBadge(performanceTag)}
        {downloadButton}
      </div>
    </div>
  )
}

export default ExploreModelItemHeader
