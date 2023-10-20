import DownloadModelContent from '../DownloadModelContent'
import ModelDownloadButton from '../ModelDownloadButton'
import ModelDownloadingButton from '../ModelDownloadingButton'
import { useAtomValue } from 'jotai'
import { modelDownloadStateAtom } from '@/_helpers/atoms/DownloadState.atom'
import { AssistantModel } from '@/_models/AssistantModel'

type Props = {
  model: AssistantModel
  isRecommend: boolean
  required?: string
  onDownloadClick?: (model: AssistantModel) => void
}

const AvailableModelCard: React.FC<Props> = ({
  model,
  isRecommend,
  required,
  onDownloadClick,
}) => {
  const downloadState = useAtomValue(modelDownloadStateAtom)

  let isDownloading = false
  let total = 0
  let transferred = 0

  if (model._id && downloadState[model._id]) {
    isDownloading =
      downloadState[model._id].error == null &&
      downloadState[model._id].percent < 1

    if (isDownloading) {
      total = downloadState[model._id].size.total
      transferred = downloadState[model._id].size.transferred
    }
  }

  const downloadButton = isDownloading ? (
    <div className="flex w-1/5 items-start justify-end">
      <ModelDownloadingButton total={total} value={transferred} />
    </div>
  ) : (
    <div className="flex w-1/5 items-center justify-end">
      <ModelDownloadButton callback={() => onDownloadClick?.(model)} />
    </div>
  )

  return (
    <div className="rounded-lg border border-gray-200">
      <div className="flex justify-between gap-2.5 px-3 py-4">
        <DownloadModelContent
          required={required}
          author={model.author}
          description={model.shortDescription}
          isRecommend={isRecommend}
          name={model.name}
          type={model.type}
        />
        {downloadButton}
      </div>
      {/* <ViewModelDetailButton callback={handleViewDetails} /> */}
    </div>
  )
}

export default AvailableModelCard
