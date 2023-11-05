/* eslint-disable react/display-name */

import { forwardRef, useEffect, useState } from 'react'

import { Badge } from '@janhq/uikit'

import useGetMostSuitableModelVersion from '@/hooks/useGetMostSuitableModelVersion'

import ExploreModelItemHeader from '@/screens/ExploreModels/ExploreModelItemHeader'
import ModelVersionList from '@/screens/ExploreModels/ModelVersionList'

import { toGigabytes } from '@/utils/converter'
import { displayDate } from '@/utils/datetime'

type Props = {
  model: ModelCatalog
}

const ExploreModelItem = forwardRef<HTMLDivElement, Props>(({ model }, ref) => {
  const [show, setShow] = useState(false)

  const { availableVersions } = model
  const { suitableModel, getMostSuitableModelVersion } =
    useGetMostSuitableModelVersion()

  useEffect(() => {
    getMostSuitableModelVersion(availableVersions)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableVersions])

  if (!suitableModel) {
    return null
  }

  const { quantMethod, bits, maxRamRequired, usecase } = suitableModel

  return (
    <div
      ref={ref}
      className="mb-4 flex flex-col rounded-md border border-border bg-background/60"
    >
      <ExploreModelItemHeader
        suitableModel={suitableModel}
        exploreModel={model}
      />
      <div className="flex flex-col p-4">
        <div className="mb-4 flex flex-col gap-1">
          <span className="font-semibold">About</span>
          <p>{model.longDescription}</p>
        </div>

        <div className="mb-4 flex space-x-6 border-b border-border pb-4">
          <div>
            <span className="font-semibold">Author</span>
            <p className="mt-1 font-medium">{model.author}</p>
          </div>
          <div>
            <span className="mb-1 font-semibold">Compatibility</span>
            <div className="mt-1 flex gap-2">
              <Badge themes="secondary" className="line-clamp-1 max-w-[400px]">
                {usecase}
              </Badge>
              <Badge themes="secondary" className="line-clamp-1">
                {toGigabytes(maxRamRequired)} RAM required
              </Badge>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-3 items-center gap-4">
          <div>
            <span className="font-semibold">Version</span>
            <div className="mt-2 flex space-x-2">
              <Badge themes="outline">v{model.version}</Badge>
              {quantMethod && <Badge themes="outline">{quantMethod}</Badge>}
              <Badge themes="outline">{`${bits} Bits`}</Badge>
            </div>
          </div>
          <div>
            <span className="font-semibold">Release Date</span>
            <p className="mt-1 ">{displayDate(model.releaseDate)}</p>
          </div>
          <div>
            <span className="font-semibold">Tags</span>
            <div className="mt-2 flex space-x-2">
              {model.tags.map((tag, i) => (
                <Badge key={i} themes="outline">
                  {tag}
                </Badge>
              ))}
            </div>
          </div>
        </div>

        {model.availableVersions?.length > 0 && (
          <div className="mt-5 w-full rounded-md border border-border bg-background p-2">
            <button onClick={() => setShow(!show)} className="w-full">
              {!show
                ? '+ Show Available Versions'
                : '- Collapse Available Versions'}
            </button>

            {show && (
              <ModelVersionList
                model={model}
                versions={model.availableVersions}
                recommendedVersion={suitableModel?._id ?? ''}
              />
            )}
          </div>
        )}
      </div>
    </div>
  )
})

export default ExploreModelItem
