import React from 'react'
import CompactLogo from '@containers/Logo/CompactLogo'

import HeaderTitle from '@/_components/HeaderTitle'
import DownloadedModelTable from '@/_components/DownloadedModelTable'
import ActiveModelTable from '@/_components/ActiveModelTable'
import DownloadingModelTable from '@/_components/DownloadingModelTable'

import ModelItem from './ModelItems'

const MyModelsScreen = () => {
  return (
    <div className="flex h-full overflow-y-scroll">
      <div className="p-6">
        <h1 className="text-xl font-semibold">My Models</h1>

        <div className="mt-8">
          <ModelItem />

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

        <p>This is old one</p>
        <div className="overflow-y-auto">
          <ActiveModelTable />
          <DownloadingModelTable />
          <DownloadedModelTable />
        </div>
      </div>
    </div>
  )
}

export default MyModelsScreen
