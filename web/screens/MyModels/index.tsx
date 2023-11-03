import React, { Fragment } from 'react'

import { useAtomValue } from 'jotai'

import { LayoutGrid } from 'lucide-react'

// import ActiveModelTable from '@/components/ActiveModelTable'
import DownloadedModelTable from '@/components/DownloadedModelTable'
// import DownloadingModelTable from '@/components/DownloadingModelTable'

import { MainViewState } from '@/constants/screens'

import { useGetDownloadedModels } from '@/hooks/useGetDownloadedModels'

import { useMainViewState } from '@/hooks/useMainViewState'

import { formatDownloadPercentage } from '@/utils/converter'

import { modelDownloadStateAtom } from '@/helpers/atoms/DownloadState.atom'

const MyModelsScreen = () => {
  const { downloadedModels } = useGetDownloadedModels()
  const modelDownloadStates = useAtomValue(modelDownloadStateAtom)
  const { setMainViewState } = useMainViewState()

  const downloadStates: DownloadState[] = []
  for (const [, value] of Object.entries(modelDownloadStates)) {
    downloadStates.push(value)
  }

  const isDownloadingFirstModel = downloadStates.length > 0

  if (!downloadedModels || downloadedModels.length === 0)
    return (
      <div className="flex h-full items-center justify-center px-4">
        <div className="text-center">
          <LayoutGrid size={32} className="text-accent/50 mx-auto" />
          <div className="mt-4">
            {isDownloadingFirstModel ? (
              <div className="relative">
                <div className="mt-4">
                  <h1 className="text-2xl font-bold leading-snug">
                    Donwloading your first model
                  </h1>
                  <p className="text-muted-foreground mt-1">
                    {downloadStates[0].fileName} -{' '}
                    {formatDownloadPercentage(downloadStates[0].percent)}
                  </p>
                </div>
              </div>
            ) : (
              <Fragment>
                <h1 className="text-2xl font-bold leading-snug">{`Ups, You don't have a model.`}</h1>
                <p className="text-muted-foreground mt-1 text-base">{`let’s download your first model`}</p>
                <button
                  className="mt-4"
                  onClick={() => setMainViewState(MainViewState.ExploreModel)}
                >
                  Explore Models
                </button>
              </Fragment>
            )}
          </div>
        </div>
      </div>
    )

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
          <DownloadedModelTable />
        </div>
      </div>
    </div>
  )
}

export default MyModelsScreen
