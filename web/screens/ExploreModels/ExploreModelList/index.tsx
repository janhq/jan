import { ModelCatalog } from '@janhq/core/lib/types'

import ExploreModelItem from '@/screens/ExploreModels/ExploreModelItem'

type Props = {
  models: ModelCatalog[]
}

const ExploreModelList: React.FC<Props> = ({ models }) => (
  <div className="relative h-full w-full flex-shrink-0">
    {models?.map((item, i) => (
      <ExploreModelItem key={item.name + '/' + item.id} model={item} />
    ))}
  </div>
)

export default ExploreModelList
