/* eslint-disable react-hooks/exhaustive-deps */
import { useCallback, useEffect, useMemo, useState } from 'react'

import { ModelCatalog, ModelVersion } from '@janhq/core/lib/types'
import { Badge, Button } from '@janhq/uikit'

import { atom, useAtomValue } from 'jotai'

import ModalCancelDownload from '@/containers/ModalCancelDownload'

import { MainViewState } from '@/constants/screens'

import { ModelPerformance, TagType } from '@/constants/tagType'

import useDownloadModel from '@/hooks/useDownloadModel'
import { useDownloadState } from '@/hooks/useDownloadState'
import { useGetDownloadedModels } from '@/hooks/useGetDownloadedModels'
import useGetPerformanceTag from '@/hooks/useGetPerformanceTag'
import { useMainViewState } from '@/hooks/useMainViewState'

import { toGigabytes } from '@/utils/converter'

import { totalRamAtom } from '@/helpers/atoms/SystemBar.atom'

type Props = {
  suitableModel: ModelVersion
  exploreModel: ModelCatalog
}

const ExploreModelItemHeader: React.FC<Props> = ({
  suitableModel,
  exploreModel,
}) => {
  const { downloadModel } = useDownloadModel()
  const { downloadedModels } = useGetDownloadedModels()
  const { modelDownloadStateAtom, downloadStates } = useDownloadState()
  const { getPerformanceForModel } = useGetPerformanceTag()
  const [title, setTitle] = useState<string>('Recommended')
  const totalRam = useAtomValue(totalRamAtom)
  const [performanceTag, setPerformanceTag] = useState<TagType>(
    ModelPerformance.PerformancePositive
  )
  const downloadAtom = useMemo(
    () => atom((get) => get(modelDownloadStateAtom)[suitableModel.name]),
    [suitableModel.name]
  )
  const downloadState = useAtomValue(downloadAtom)
  const { setMainViewState } = useMainViewState()

  const calculatePerformance = useCallback(
    (suitableModel: ModelVersion) => async () => {
      const { title, performanceTag } = await getPerformanceForModel(
        suitableModel,
        totalRam
      )
      setPerformanceTag(performanceTag)
      setTitle(title)
    },
    [totalRam]
  )

  useEffect(() => {
    calculatePerformance(suitableModel)
  }, [suitableModel])

  const onDownloadClick = useCallback(() => {
    downloadModel(exploreModel, suitableModel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exploreModel, suitableModel])

  // TODO: Comparing between Model Id and Version Name?
  const isDownloaded =
    downloadedModels.find((model) => model.id === suitableModel.name) != null

  let downloadButton = (
    <Button onClick={() => onDownloadClick()}>
      {suitableModel.size
        ? `Download (${toGigabytes(suitableModel.size)})`
        : 'Download'}
    </Button>
  )

  if (isDownloaded) {
    downloadButton = (
      <Button
        onClick={() => {
          setMainViewState(MainViewState.MyModels)
        }}
      >
        View Downloaded Model
      </Button>
    )
  }

  if (downloadState != null && downloadStates.length > 0) {
    downloadButton = <ModalCancelDownload suitableModel={suitableModel} />
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
        <span className="font-medium">{exploreModel.name}</span>
        {performanceTag && renderBadge(performanceTag)}
      </div>
      {downloadButton}
    </div>
  )
}

export default ExploreModelItemHeader
