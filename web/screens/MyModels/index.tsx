// import ActiveModelTable from '@/components/ActiveModelTable'
// import DownloadedModelTable from '@/components/DownloadedModelTable'
// import DownloadingModelTable from '@/components/DownloadingModelTable'

import { useDownloadState } from '@/hooks/useDownloadState'
import { useGetDownloadedModels } from '@/hooks/useGetDownloadedModels'

import BlankStateMyModel from '@/screens/MyModels/BlankState'

// import { formatDownloadPercentage } from '@/utils/converter'

const MyModelsScreen = () => {
  const { downloadedModels } = useGetDownloadedModels()
  const { modelDownloadState, downloadStates } = useDownloadState()

  if (downloadedModels.length === 0) return <BlankStateMyModel />

  return (
    <div className="flex h-full w-full overflow-y-auto">
      <div className="w-full p-5">
        <h1
          data-testid="testid-mymodels-header"
          className="text-lg font-semibold"
        >
          My Models
        </h1>
        <p className="mt-2 text-gray-600 dark:text-gray-400">
          You have <span>{downloadedModels.length}</span> models downloaded
        </p>
        <div>
          {/* <ActiveModelTable /> */}
          {/* <DownloadingModelTable /> */}
          {/* <DownloadedModelTable /> */}
        </div>
      </div>
    </div>
  )
}

export default MyModelsScreen
