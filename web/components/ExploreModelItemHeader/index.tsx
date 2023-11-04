import { useCallback, useEffect, useMemo } from 'react'

import { atom, useAtomValue, useSetAtom } from 'jotai'

import { MainViewState } from '@/constants/screens'

import useDownloadModel from '@/hooks/useDownloadModel'
import { useDownloadState } from '@/hooks/useDownloadState'
import { useGetDownloadedModels } from '@/hooks/useGetDownloadedModels'
import useGetPerformanceTag from '@/hooks/useGetPerformanceTag'
import { useMainViewState } from '@/hooks/useMainViewState'

import { formatDownloadPercentage, toGigabytes } from '@/utils/converter'

import ConfirmationModal from '../ConfirmationModal'
import SimpleTag from '../SimpleTag'

import { showingCancelDownloadModalAtom } from '@/helpers/atoms/Modal.atom'

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
  const { modelDownloadStateAtom } = useDownloadState()
  const { performanceTag, title, getPerformanceForModel } =
    useGetPerformanceTag()
  const downloadAtom = useMemo(
    () => atom((get) => get(modelDownloadStateAtom)[suitableModel._id]),
    [suitableModel._id]
  )
  const downloadState = useAtomValue(downloadAtom)
  const { setMainViewState } = useMainViewState()
  const setShowingCancelDownloadModal = useSetAtom(
    showingCancelDownloadModalAtom
  )

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
    <button onClick={() => onDownloadClick()}>
      {suitableModel.size
        ? `Download (${toGigabytes(suitableModel.size)})`
        : 'Download'}
    </button>
  )

  if (isDownloaded) {
    downloadButton = (
      <button
        onClick={() => {
          setMainViewState(MainViewState.MyModel)
        }}
      >
        View Downloaded Model
      </button>
    )
  }

  if (downloadState != null) {
    // downloading
    downloadButton = (
      <button
        onClick={() => {
          setShowingCancelDownloadModal(true)
        }}
      >
        Cancel ({formatDownloadPercentage(downloadState.percent)})
      </button>
    )
  }

  const cancelDownloadModal =
    downloadState != null ? (
      <ConfirmationModal
        atom={showingCancelDownloadModalAtom}
        title="Cancel Download"
        description={`Are you sure you want to cancel the download of ${downloadState?.fileName}?`}
        onConfirm={() => {
          window.coreAPI?.abortDownload(downloadState?.fileName)
        }}
      />
    ) : (
      <></>
    )

  return (
    <div className="flex items-center justify-between rounded-t-md border-b border-border bg-background/50 px-4 py-2">
      <div className="flex items-center gap-2">
        <span>{exploreModel.name}</span>
        {performanceTag && (
          <SimpleTag title={title} type={performanceTag} clickable={false} />
        )}
      </div>
      {downloadButton}
      {cancelDownloadModal}
    </div>
  )
}

export default ExploreModelItemHeader
