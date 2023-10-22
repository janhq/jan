import React from 'react'
// import CompactLogo from '@containers/Logo/CompactLogo'

// import HeaderTitle from '@/_components/HeaderTitle'
import DownloadedModelTable from '@/_components/DownloadedModelTable'
import ActiveModelTable from '@/_components/ActiveModelTable'
import DownloadingModelTable from '@/_components/DownloadingModelTable'

import { useGetDownloadedModels } from '@hooks/useGetDownloadedModels'

import ModelItem from './ModelItems'

const MyModelsScreen = () => {
  const { downloadedModels } = useGetDownloadedModels()

  console.log(downloadedModels)

  if (!downloadedModels || downloadedModels.length === 0) return null

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
