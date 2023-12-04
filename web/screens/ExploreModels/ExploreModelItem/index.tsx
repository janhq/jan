/* eslint-disable react/display-name */

import { forwardRef } from 'react'

import { Model } from '@janhq/core'
import { Badge } from '@janhq/uikit'

import ExploreModelItemHeader from '@/screens/ExploreModels/ExploreModelItemHeader'

type Props = {
  model: Model
}

const ExploreModelItem = forwardRef<HTMLDivElement, Props>(({ model }, ref) => {
  return (
    <div
      ref={ref}
      className="mb-4 flex flex-col rounded-md border border-border bg-background/60"
    >
      <ExploreModelItemHeader model={model} />
      <div className="flex flex-col p-4">
        <div className="mb-4 flex flex-col gap-1">
          <span className="font-semibold">About</span>
          <p>{model.description}</p>
        </div>

        <div className="mb-4 flex space-x-6 border-b border-border pb-4">
          <div>
            <span className="font-semibold">Author</span>
            <p className="mt-1 font-medium">{model.metadata.author}</p>
          </div>
          <div>
            <span className="mb-1 font-semibold">Compatibility</span>
            <div className="mt-1 flex gap-2">
              {/* <Badge
                themes="secondary"
                className="line-clamp-1 lg:line-clamp-none"
                title={`${toGigabytes(
                  model.metadata.maxRamRequired // TODO: check this
                )} RAM required`}
              >
                {toGigabytes(model.metadata.maxRamRequired)} RAM required
              </Badge> */}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-3 items-center gap-4">
          <div>
            <span className="font-semibold">Version</span>
            <div className="mt-2 flex space-x-2">
              <Badge themes="outline">v{model.version}</Badge>
            </div>
          </div>
          <div>
            <span className="font-semibold">Tags</span>
            <div className="mt-2 flex space-x-2">
              {model.metadata.tags.map((tag, i) => (
                <Badge key={i} themes="outline">
                  {tag}
                </Badge>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
})

export default ExploreModelItem
