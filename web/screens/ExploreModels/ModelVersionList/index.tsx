import { ModelCatalog, ModelVersion } from '@janhq/core/lib/types'

import ModelVersionItem from '../ModelVersionItem'

type Props = {
  model: ModelCatalog
  versions: ModelVersion[]
  recommendedVersion: string
}

export default function ModelVersionList({
  model,
  versions,
  recommendedVersion,
}: Props) {
  return (
    <div className="pt-4">
      {versions.map((item) => (
        <ModelVersionItem
          key={item.name}
          model={model}
          modelVersion={item}
          isRecommended={item.name === recommendedVersion}
        />
      ))}
    </div>
  )
}
