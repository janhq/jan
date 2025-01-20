import { Model, ModelSource } from '@janhq/core'

import ModelItem from '@/screens/Hub/ModelList/ModelItem'

import { useGetModelSources } from '@/hooks/useModelSource'

type Props = {
  models: Model[]
  onSelectedModel: (model: ModelSource) => void
}

const ModelList = ({ models, onSelectedModel }: Props) => {
  const { sources } = useGetModelSources()

  return (
    <div className="relative h-full w-full flex-shrink-0">
      {sources?.map((model) => (
        <ModelItem
          key={model.id}
          model={model}
          onSelectedModel={() => onSelectedModel(model)}
        />
      ))}
    </div>
  )
}

export default ModelList
