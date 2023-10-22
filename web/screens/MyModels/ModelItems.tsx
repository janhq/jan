import React from 'react'

import { useGetDownloadedModels } from '@hooks/useGetDownloadedModels'

const ModelItem = () => {
  const { downloadedModels } = useGetDownloadedModels()

  console.log(downloadedModels)

  if (!downloadedModels || downloadedModels.length === 0) return null

  return (
    <div className="grid grid-cols-3">
      <p>
        Lorem ipsum dolor sit amet consectetur adipisicing elit. Ullam facilis
        itaque, fugiat obcaecati beatae laboriosam, ut totam ipsum iste
        blanditiis possimus officiis natus nemo autem voluptas. Laudantium eum
        eos consectetur.
      </p>
    </div>
  )
}

export default ModelItem
