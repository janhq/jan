import { ScrollArea } from '@janhq/uikit'

import Loader from '@/containers/Loader'

import { useGetConfiguredModels } from '@/hooks/useGetConfiguredModels'

import ExploreModelList from './ExploreModelList'

const ExploreModelsScreen = () => {
  const { loading, models } = useGetConfiguredModels()
  if (loading) return <Loader description="loading ..." />

  return (
    <div className="flex h-full w-full overflow-y-auto bg-background">
      <div className="h-full w-full p-4">
        <div className="h-full" data-test-id="testid-explore-models">
          <ScrollArea>
            <ExploreModelList models={models} />
          </ScrollArea>
        </div>
      </div>
    </div>
  )
}

export default ExploreModelsScreen
