import React, { Fragment, useEffect } from 'react'

import Loader from '@/containers/Loader'
import useGetConfiguredModels from '@/hooks/useGetConfiguredModels'

import ExploreModelList from '@/screens/ExploreModels/ExploreModelList'

import { getConfiguredModels } from '@/hooks/useGetDownloadedModels'

const ExploreModelsScreen = () => {
  const { loading } = useGetConfiguredModels()

  return (
    <div className="flex h-full w-full overflow-y-auto">
      <div className="h-full w-full p-5">
        {loading ? (
          <Loader />
        ) : (
          <Fragment>
            <h1 className="text-lg font-semibold">Explore Models</h1>
            <div className="mt-5 h-full">
              <ExploreModelList />
            </div>
          </Fragment>
        )}
      </div>
    </div>
  )
}

export default ExploreModelsScreen
