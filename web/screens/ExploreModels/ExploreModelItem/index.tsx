/* eslint-disable react/display-name */

import { forwardRef, useEffect, useState } from 'react'

import useGetMostSuitableModelVersion from '@/hooks/useGetMostSuitableModelVersion'

import ExploreModelItemHeader from '@/screens/ExploreModels/ExploreModelItemHeader'
import ModelVersionList from '@/screens/ExploreModels/ModelVersionList'

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

        <div className="flex justify-between">
          {/* <div className="flex flex-1 flex-col gap-y-4">
            <div className="flex flex-col gap-1">
              <div className="font-semibold">Release Date</div>
              <p className="mt-1 ">{displayDate(model.releaseDate)}</p>
            </div>
            <div className="flex flex-col gap-2">
              <div className="font-semibold">Version</div>
              <div className="flex gap-2">
                <Badge>v{model.version}</Badge>
                {quantMethod && <Badge themes="outline">{quantMethod}</Badge>}
                <Badge themes="outline">{`${bits} Bits`}</Badge>
              </div>
            </div>
          </div> */}

          {/* <div className="flex flex-1 flex-col gap-y-4">
            <div>
              <div className="font-semibold">Author</div>
              <p className="mt-1 ">{model.author}</p>
            </div>
            <div className="flex flex-col gap-2">
              <div className="font-semibold">Compatibility</div>
              <div className="flex gap-2">
                <Badge themes="outline" className="line-clamp-1">
                  {usecase}
                </Badge>
                <Badge themes="outline" className="line-clamp-1">
                  {toGigabytes(maxRamRequired)} RAM required
                </Badge>
              </div>
            </div>
          </div> */}

          {/* <div className="flex flex-1 flex-col gap-y-4">
            <div>
              <div className="font-medium">Tags</div>
              <div className="mt-1 flex flex-wrap gap-2">
                {model.tags.map((tag) => (
                  <SimpleTag
                    key={tag}
                    title={tag}
                    type={MiscellanousTag.MiscellanousDefault}
                    clickable={false}
                  />
                ))}
              </div>
            </div>
          </div> */}
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
