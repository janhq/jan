import { Model, ModelSource } from '@janhq/core'

import { useGetModelSources } from '@/hooks/useModelSource'

import ModelItem from '@/screens/Hub/ModelList/ModelItem'

type Props = {
  models: Model[]
  onSelectedModel: (model: ModelSource) => void
}

const ModelList = ({ onSelectedModel }: Props) => {
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
