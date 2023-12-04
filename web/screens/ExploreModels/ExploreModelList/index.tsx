import { Model } from '@janhq/core'

import ExploreModelItem from '@/screens/ExploreModels/ExploreModelItem'

type Props = {
  models: Model[]
}

const ExploreModelList: React.FC<Props> = ({ models }) => {
  return (
    <div className="relative h-full w-full flex-shrink-0">
      {models
        ?.sort((a, b) => a.metadata.size - b.metadata.size)
        ?.map((model) => <ExploreModelItem key={model.id} model={model} />)}
    </div>
  )
}

export default ExploreModelList
