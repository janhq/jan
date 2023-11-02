import React from 'react'

import ModelVersionItem from '../ModelVersionItem'
import { ModelCatalog, ModelVersion } from '@janhq/core/lib/types'

type Props = {
  model: ModelCatalog
  versions: ModelVersion[]
  recommendedVersion: string
}

const ModelVersionList: React.FC<Props> = ({
  model,
  versions,
  recommendedVersion,
}) => {
  return (
    <div className="pt-4">
      {versions.map((item) => (
        <ModelVersionItem
          key={item._id}
          model={model}
          modelVersion={item}
          isRecommended={item._id === recommendedVersion}
        />
      ))}
    </div>
  )
}

export default ModelVersionList
