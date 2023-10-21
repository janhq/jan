import React from 'react'
import CompactLogo from '@containers/Logo/CompactLogo'

import HeaderTitle from '@/_components/HeaderTitle'
import DownloadedModelTable from '@/_components/DownloadedModelTable'
import ActiveModelTable from '@/_components/ActiveModelTable'
import DownloadingModelTable from '@/_components/DownloadingModelTable'

const MyModelsScreen = () => {
  return (
    <div className="flex h-full">
      <div className="p-6">
        <h1 className="text-xl font-semibold">My Models</h1>
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
