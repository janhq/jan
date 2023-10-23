import React, { Fragment } from 'react'
import { useSetAtom } from 'jotai'
import { Button } from '@uikit'
import { modelDownloadStateAtom } from '@helpers/atoms/DownloadState.atom'
import DownloadedModelTable from '@/_components/DownloadedModelTable'
import ActiveModelTable from '@/_components/ActiveModelTable'
import DownloadingModelTable from '@/_components/DownloadingModelTable'
import { useAtomValue } from 'jotai'
import { useGetDownloadedModels } from '@hooks/useGetDownloadedModels'
import { formatDownloadPercentage } from '@utils/converter'
import { LayoutGrid } from 'lucide-react'
import {
  setMainViewStateAtom,
  MainViewState,
} from '@helpers/atoms/MainView.atom'
import Loader from '@containers/Loader'
import ModelItem from './ModelItems'

const MyModelsScreen = () => {
  const { downloadedModels } = useGetDownloadedModels()
  const setMainViewState = useSetAtom(setMainViewStateAtom)
  const modelDownloadStates = useAtomValue(modelDownloadStateAtom)

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
                <Loader />
                <div className="mt-8">
                  <h1 className="text-2xl font-bold leading-snug">
                    Donwloading your first model
                  </h1>
                  <p className="text-muted-foreground ">
                    {downloadStates[0].fileName} -{' '}
                    {formatDownloadPercentage(downloadStates[0].percent)}
                  </p>
                </div>
              </div>
            ) : (
              <Fragment>
                <h1 className="text-2xl font-bold leading-snug">{`Ups, You don't have a model.`}</h1>
                <p className="text-muted-foreground mt-1 text-base">{`let’s download your first model`}</p>
                <Button
                  className="mt-4"
                  onClick={() => setMainViewState(MainViewState.ExploreModel)}
                >
                  Explore Models
                </Button>
              </Fragment>
            )}
          </div>
        </div>
      </div>
    )

  return (
    <div className="flex h-full overflow-y-scroll">
      <div className="p-6">
        <h1 className="text-xl font-semibold">My Models</h1>
        <p className="mt-2 text-gray-600 dark:text-gray-400">
          You have <span>{downloadedModels.length}</span> models downloaded
        </p>

        <div className="mt-6">
          <ModelItem downloadedModels={downloadedModels} />
          {/* {Array.from(Array(100).keys()).map((i) => {
            return (
              <div key={i}>
                <p>
                  Lorem ipsum dolor sit amet consectetur adipisicing elit.
                  Obcaecati voluptates dicta fugiat adipisci! Quaerat dolores
                  repudiandae culpa maxime iste aliquam ducimus, hic consequatur
                  ex error repellat, autem officia eos veniam.
                </p>
              </div>
            )
          })} */}
        </div>

        {/* <p>This is old one</p> */}
        <div>
          <ActiveModelTable />
          <DownloadingModelTable />
          <DownloadedModelTable />
        </div>
      </div>
    </div>
  )
}

export default MyModelsScreen
