import { Model } from '@janhq/core'

import ModelVersionItem from '../ModelVersionItem'

type Props = {
  models: Model[]
  recommendedVersion: string
}

export default function ModelVersionList({
  models,
  recommendedVersion,
}: Props) {
  return (
    <div className="pt-4">
      {models.map((model) => (
        <ModelVersionItem
          key={model.name}
          model={model}
          isRecommended={model.name === recommendedVersion}
        />
      ))}
    </div>
  )
}
