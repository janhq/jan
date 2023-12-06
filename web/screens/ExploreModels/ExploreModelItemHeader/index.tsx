/* eslint-disable react-hooks/exhaustive-deps */
import { useCallback, useMemo } from 'react'

import { Model } from '@janhq/core'
import { Button } from '@janhq/uikit'

import { atom, useAtomValue } from 'jotai'

import { ChevronDownIcon } from 'lucide-react'

import { twMerge } from 'tailwind-merge'

import ModalCancelDownload from '@/containers/ModalCancelDownload'

import { MainViewState } from '@/constants/screens'

// import { ModelPerformance, TagType } from '@/constants/tagType'

import { useActiveModel } from '@/hooks/useActiveModel'
import useDownloadModel from '@/hooks/useDownloadModel'
import { useDownloadState } from '@/hooks/useDownloadState'
import { useGetDownloadedModels } from '@/hooks/useGetDownloadedModels'
import { useMainViewState } from '@/hooks/useMainViewState'

import { toGigabytes } from '@/utils/converter'

type Props = {
  model: Model
  onClick: () => void
  open: string
}

const ExploreModelItemHeader: React.FC<Props> = ({ model, onClick, open }) => {
  const { downloadModel } = useDownloadModel()
  const { downloadedModels } = useGetDownloadedModels()
  const { modelDownloadStateAtom, downloadStates } = useDownloadState()
  const { startModel } = useActiveModel()
  // const [title, setTitle] = useState<string>('Recommended')

  // const [performanceTag, setPerformanceTag] = useState<TagType>(
  //   ModelPerformance.PerformancePositive
  // )

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
    <Button onClick={() => onDownloadClick()}>Download</Button>
  )

  const onUseModelClick = () => {
    startModel(model.id)
    setMainViewState(MainViewState.Thread)
  }

  if (isDownloaded) {
    downloadButton = (
      <Button
        themes="success"
        className="min-w-[98px]"
        onClick={onUseModelClick}
      >
        Use
      </Button>
    )
  }

  if (downloadState != null && downloadStates.length > 0) {
    downloadButton = <ModalCancelDownload model={model} />
  }

  // const renderBadge = (performance: TagType) => {
  //   switch (performance) {
  //     case ModelPerformance.PerformancePositive:
  //       return <Badge themes="success">{title}</Badge>

  //     case ModelPerformance.PerformanceNeutral:
  //       return <Badge themes="secondary">{title}</Badge>

  //     case ModelPerformance.PerformanceNegative:
  //       return <Badge themes="danger">{title}</Badge>

  //     default:
  //       break
  //   }
  // }

  return (
    <div
      className="cursor-pointer rounded-t-md bg-background/50"
      onClick={onClick}
    >
      {model.metadata.cover && (
        <div className="relative h-full w-full">
          <img src={model.metadata.cover} alt={`Cover - ${model.id}`} />
        </div>
      )}
      <div className="flex items-center justify-between p-4">
        <div className="flex items-center gap-2">
          <span className="font-bold">{model.name}</span>
        </div>
        <div className="inline-flex items-center space-x-2">
          <span className="mr-4 font-semibold text-muted-foreground">
            {toGigabytes(model.metadata.size)}
          </span>
          {downloadButton}
          <ChevronDownIcon
            className={twMerge(
              'h-5 w-5 flex-none text-gray-400',
              open === model.id && 'rotate-180'
            )}
          />
        </div>
      </div>
    </div>
  )
}

export default ExploreModelItemHeader
