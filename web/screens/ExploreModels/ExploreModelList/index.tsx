/* eslint-disable @typescript-eslint/naming-convention */
import { Model } from '@janhq/core'

import ExploreModelItem from '@/screens/ExploreModels/ExploreModelItem'

type Props = {
  models: Model[]
}

const ExploreModelList: React.FC<Props> = ({ models }) => {
  const sortOrder: Record<string, number> = {
    '7b': 1,
    '13b': 2,
    '34b': 3,
    '70b': 4,
    '120b': 5,
    'tiny': 6,
  }
  const sortedModels = models?.sort((a, b) => {
    const aIsFeatured = a.metadata.tags.includes('Featured')
    const bIsFeatured = b.metadata.tags.includes('Featured')
    const aIsRecommended = a.metadata.tags.includes('Recommended')
    const bIsRecommended = b.metadata.tags.includes('Recommended')
    const aNumericTag =
      a.metadata.tags.find((tag) => !!sortOrder[tag.toLowerCase()]) ?? 'Tiny'
    const bNumericTag =
      b.metadata.tags.find((tag) => !!sortOrder[tag.toLowerCase()]) ?? 'Tiny'

    if (aIsFeatured !== bIsFeatured) return aIsFeatured ? -1 : 1
    if (aNumericTag !== bNumericTag)
      return (
        sortOrder[aNumericTag.toLowerCase()] -
        sortOrder[bNumericTag.toLowerCase()]
      )
    if (aIsRecommended !== bIsRecommended) return aIsRecommended ? -1 : 1
    return a.metadata.size - b.metadata.size
  })
  return (
    <div className="relative h-full w-full flex-shrink-0">
      {sortedModels?.map((model) => (
        <ExploreModelItem key={model.id} model={model} />
      ))}
    </div>
  )
}

export default ExploreModelList
