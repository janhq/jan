import { ModelSource } from '@janhq/core'

import ModelItem from '@/screens/Hub/ModelList/ModelItem'

type Props = {
  models: ModelSource[]
  onSelectedModel: (model: ModelSource) => void
}

const ModelList = ({ models, onSelectedModel }: Props) => {
  return (
    <div className="w-full">
      {models.map((model) => (
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
