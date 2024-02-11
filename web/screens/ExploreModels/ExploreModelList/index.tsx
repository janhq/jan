import { Model } from '@janhq/core'

import ExploreModelItem from '@/screens/ExploreModels/ExploreModelItem'

type Props = {
  models: Model[]
}

const ExploreModelList: React.FC<Props> = ({ models }) => {
  const takenModelIds: string[] = []
  const featuredModels = models
    .filter((m) => {
      if (m.metadata?.tags?.includes('Featured')) {
        takenModelIds.push(m.id)
        return m
      }
    })
    .sort((m1, m2) => m1.metadata.size - m2.metadata.size)

  const recommendedModels = models
    .filter((m) => {
      if (m.metadata?.tags?.includes('Recommended')) {
        takenModelIds.push(m.id)
        return m
      }
    })
    .sort((m1, m2) => m1.metadata.size - m2.metadata.size)

  const openAiModels = models
    .filter((m) => {
      if (m.engine === 'openai') {
        takenModelIds.push(m.id)
        return m
      }
    })
    .sort((m1: Model, m2: Model) => m1.name.localeCompare(m2.name))

  const remainingModels = models
    .filter((m) => !takenModelIds.includes(m.id))
    .sort((m1, m2) => m1.metadata.size - m2.metadata.size)

  const sortedModels: Model[] = [
    ...featuredModels,
    ...recommendedModels,
    ...openAiModels,
    ...remainingModels,
  ]

  return (
    <div className="relative h-full w-full flex-shrink-0">
      {sortedModels?.map((model) => (
        <ExploreModelItem key={model.id} model={model} />
      ))}
    </div>
  )
}

export default ExploreModelList
