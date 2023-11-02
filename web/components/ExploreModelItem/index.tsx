/* eslint-disable react/display-name */

'use client'

import { forwardRef, useEffect, useState } from 'react'

import useGetMostSuitableModelVersion from '@/hooks/useGetMostSuitableModelVersion'

import { toGigabytes } from '@/utils/converter'
import { displayDate } from '@/utils/datetime'

import ExploreModelItemHeader from '../ExploreModelItemHeader'
import ModelVersionList from '../ModelVersionList'
import SimpleTag from '../SimpleTag'

import {
  MiscellanousTag,
  NumOfBit,
  QuantMethodTag,
  RamRequired,
  UsecaseTag,
  VersionTag,
} from '../SimpleTag/TagType'

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
      className="border-border mb-4 flex flex-col rounded-md border bg-background/60"
    >
      <ExploreModelItemHeader
        suitableModel={suitableModel}
        exploreModel={model}
      />
      <div className="flex flex-col p-4">
        <div className="mb-4 flex flex-col gap-1">
          <span className="font-semibold">About</span>
          <span className="text-muted-foreground leading-relaxed">
            {model.longDescription}
          </span>
        </div>

        <div className="flex justify-between">
          <div className="flex flex-1 flex-col gap-y-4">
            <div className="flex flex-col gap-1">
              <div className="font-semibold">Release Date</div>
              <p className="text-muted-foreground mt-1">
                {displayDate(model.releaseDate)}
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <div className="font-semibold">Version</div>
              <div className="flex gap-2">
                <SimpleTag
                  title={model.version}
                  type={VersionTag.Version}
                  clickable={false}
                />
                <SimpleTag
                  title={quantMethod}
                  type={QuantMethodTag.Default}
                  clickable={false}
                />
                <SimpleTag
                  title={`${bits} Bits`}
                  type={NumOfBit.Default}
                  clickable={false}
                />
              </div>
            </div>
          </div>

          <div className="flex flex-1 flex-col gap-y-4">
            <div>
              <div className="font-semibold">Author</div>
              <p className="text-muted-foreground mt-1">{model.author}</p>
            </div>
            <div className="flex flex-col gap-2">
              <div className="font-semibold">Compatibility</div>
              <div className="flex gap-2">
                <SimpleTag
                  title={usecase}
                  type={UsecaseTag.UsecaseDefault}
                  clickable={false}
                />
                <SimpleTag
                  title={`${toGigabytes(maxRamRequired)} RAM required`}
                  type={RamRequired.RamDefault}
                  clickable={false}
                />
              </div>
            </div>
          </div>

          <div className="flex flex-1 flex-col gap-y-4">
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
          </div>
        </div>

        {model.availableVersions?.length > 0 && (
          <div className="border-border mt-5 w-full rounded-md border bg-background p-2">
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
