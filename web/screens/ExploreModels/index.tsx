import React from 'react'

import HeaderTitle from '@/_components/HeaderTitle'
import ExploreModelList from '@/_components/ExploreModelList'
import ExploreModelFilter from '@/_components/ExploreModelFilter'

const ExploreModelsScreen = () => {
  return (
    <div className="flex h-full overflow-y-scroll">
      <div className="p-6">
        <h1 className="text-xl font-semibold">Explore Models</h1>
        <div className="mt-9 flex flex-1 gap-x-10 overflow-hidden">
          <ExploreModelFilter />
          <ExploreModelList />
        </div>
      </div>
    </div>
  )
}

export default ExploreModelsScreen
