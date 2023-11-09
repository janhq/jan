import { ModelCatalog } from '@janhq/core/lib/types'

import ExploreModelItem from '@/screens/ExploreModels/ExploreModelItem'

type Props = {
  models: ModelCatalog[]
}

export default function ExploreModelList(props: Props) {
  const { models } = props
  return (
    <div className="relative h-full w-full flex-shrink-0">
      {models?.map((item, i) => (
        <ExploreModelItem key={item._id} model={item} />
      ))}
    </div>
  )
}
