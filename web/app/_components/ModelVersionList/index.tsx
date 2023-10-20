import React from 'react'
import ModelVersionItem from '../ModelVersionItem'
import { Product } from '@/_models/Product'
import { ModelVersion } from '@/_models/ModelVersion'

type Props = {
  model: Product
  versions: ModelVersion[]
  recommendedVersion: string
}

const ModelVersionList: React.FC<Props> = ({
  model,
  versions,
  recommendedVersion,
}) => {
  return (
    <div className="border-t border-gray-200 px-4 py-5">
      <div className="text-sm font-medium text-gray-500">
        Available Versions
      </div>
      <div className="overflow-hidden rounded-lg border border-gray-200">
        {versions.map((item) => (
          <ModelVersionItem
            key={item._id}
            model={model}
            modelVersion={item}
            isRecommended={item._id === recommendedVersion}
          />
        ))}
      </div>
    </div>
  )
}

export default ModelVersionList
