import React, { Fragment, useEffect } from 'react'
import ExploreModelList from '@screens/ExploreModels/ExploreModelList'
import useGetConfiguredModels from '@hooks/useGetConfiguredModels'
import { getConfiguredModels } from '@hooks/useGetDownloadedModels'
import Loader from '@containers/Loader'

const ExploreModelsScreen = () => {
  const { loading, models } = useGetConfiguredModels()

  useEffect(() => {
    getConfiguredModels()
  }, [])

  return (
    <div className="flex h-full w-full overflow-y-scroll">
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
