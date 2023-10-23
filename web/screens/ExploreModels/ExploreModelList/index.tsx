import React, { useEffect } from 'react'
import ExploreModelItem from '@/_components/ExploreModelItem'
import { getConfiguredModels } from '@hooks/useGetDownloadedModels'
import useGetConfiguredModels from '@hooks/useGetConfiguredModels'

const ExploreModelList: React.FC = () => {
  const { loading, models } = useGetConfiguredModels()

  useEffect(() => {
    getConfiguredModels()
  }, [])

  return (
    <div className="relative h-full w-full flex-shrink-0">
      {models.map((item) => (
        <ExploreModelItem key={item._id} model={item} />
      ))}
    </div>
  )
}

export default ExploreModelList
