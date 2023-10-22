import React from 'react'

type Props = {
  downloadedModels: AssistantModel[]
}

const ModelItem = (props: Props) => {
  const { downloadedModels } = props
  return (
    <div className="grid grid-cols-3 gap-4">
      {downloadedModels.map((model, i) => {
        return (
          <div
            key={i}
            className="rounded-lg border-r bg-gray-200 p-4 dark:border-gray-900 dark:bg-black/20"
          >
            <h6>{model.name}</h6>
            <p>{model.shortDescription}</p>
          </div>
        )
      })}
    </div>
  )
}

export default ModelItem
