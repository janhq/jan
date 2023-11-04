import Loader from '@/containers/Loader'

import { useGetConfiguredModels } from '@/hooks/useGetConfiguredModels'

import ExploreModelList from '@/screens/ExploreModels/ExploreModelList'

import { getConfiguredModels } from '@/hooks/useGetDownloadedModels'

  if (loading) return <Loader description="loading ..." />

  return (
    <div className="flex h-full w-full overflow-y-auto">
      <div className="h-full w-full p-5">
        <h1 className="text-lg font-semibold">Explore Models</h1>
        <div className="mt-5 h-full">
          <ExploreModelList models={models} />
        </div>
      </div>
    </div>
  )
}

export default ExploreModelsScreen
