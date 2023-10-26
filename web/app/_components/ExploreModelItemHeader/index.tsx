import SimpleTag from '../SimpleTag'
import PrimaryButton from '../PrimaryButton'
import { formatDownloadPercentage, toGigabytes } from '@utils/converter'
import SecondaryButton from '../SecondaryButton'
import { useCallback, useEffect, useMemo } from 'react'
import useGetPerformanceTag from '@hooks/useGetPerformanceTag'
import useDownloadModel from '@hooks/useDownloadModel'
import { useGetDownloadedModels } from '@hooks/useGetDownloadedModels'
import { modelDownloadStateAtom } from '@helpers/atoms/DownloadState.atom'
import { atom, useAtomValue, useSetAtom } from 'jotai'
import { Button } from '@uikit'
import {
  MainViewState,
  setMainViewStateAtom,
} from '@helpers/atoms/MainView.atom'

type Props = {
  suitableModel: ModelVersion
  exploreModel: Product
}

const ExploreModelItemHeader: React.FC<Props> = ({
  suitableModel,
  exploreModel,
}) => {
  const { downloadModel } = useDownloadModel()
  const { downloadedModels } = useGetDownloadedModels()
  const { performanceTag, title, getPerformanceForModel } =
    useGetPerformanceTag()
  const downloadAtom = useMemo(
    () => atom((get) => get(modelDownloadStateAtom)[suitableModel._id]),
    [suitableModel._id]
  )
  const downloadState = useAtomValue(downloadAtom)
  const setMainViewState = useSetAtom(setMainViewStateAtom)

  useEffect(() => {
    getPerformanceForModel(suitableModel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suitableModel])

  const onDownloadClick = useCallback(() => {
    downloadModel(exploreModel, suitableModel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exploreModel, suitableModel])

  const isDownloaded =
    downloadedModels.find((model) => model._id === suitableModel._id) != null

  let downloadButton = (
    <Button themes="accent" onClick={() => onDownloadClick()}>
      {suitableModel.size
        ? `Download (${toGigabytes(suitableModel.size)})`
        : 'Download'}
    </Button>
  )

  if (isDownloaded) {
    downloadButton = (
      <Button
        size="sm"
        themes="accent"
        onClick={() => {
          setMainViewState(MainViewState.MyModel)
        }}
      >
        View Downloaded Model
      </Button>
    )
  }

  if (downloadState != null) {
    // downloading
    downloadButton = (
      <SecondaryButton
        disabled
        title={`Downloading (${formatDownloadPercentage(
          downloadState.percent
        )})`}
      />
    )
  }

  return (
    <div className="border-border bg-background/50 flex items-center justify-between rounded-t-md border-b px-4 py-2">
      <div className="flex items-center gap-2">
        <span>{exploreModel.name}</span>
        {performanceTag && (
          <SimpleTag title={title} type={performanceTag} clickable={false} />
        )}
      </div>
      {downloadButton}
    </div>
  )
}

export default ExploreModelItemHeader
