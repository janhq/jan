import { ModelSource } from '@janhq/core'

import ModelItem from '@/screens/Hub/ModelList/ModelItem'

type Props = {
  models: ModelSource[]
  onSelectedModel: (model: ModelSource) => void
  filterOption?: string
}

const ModelList = ({ models, onSelectedModel, filterOption }: Props) => {
  return (
    <div className="w-full">
      {models.length === 0 && filterOption === 'on-device' ? (
        <div className="my-4 p-2 text-center">
          <span className="text-[hsla(var(--text-tertiary))]">
            No results found
          </span>
        </div>
      ) : (
        <>
          {models.map((model) => (
            <ModelItem
              key={model.id}
              model={model}
              onSelectedModel={() => onSelectedModel(model)}
            />
          ))}
        </>
      )}
    </div>
  )
}

export default ModelList
