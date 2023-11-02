import React, { useEffect } from 'react'

import useGetConfiguredModels from '@/hooks/useGetConfiguredModels'
import { getConfiguredModels } from '@/hooks/useGetDownloadedModels'

import ExploreModelItem from '@/components/ExploreModelItem'

const ExploreModelList: React.FC = () => {
  const { models } = useGetConfiguredModels()

  return (
    <div className="relative h-full w-full flex-shrink-0">
      {models?.map((item) => <ExploreModelItem key={item._id} model={item} />)}
    </div>
  )
}

export default ExploreModelList
