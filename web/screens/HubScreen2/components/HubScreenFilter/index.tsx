import { Fragment } from 'react'

import BlankState from '@/containers/BlankState'

import useModelHub from '@/hooks/useModelHub'

import { HfModelEntry } from '@/utils/huggingface'

import BuiltInModelCard from '../BuiltInModelCard'
import HuggingFaceModelCard from '../HuggingFaceModelCard'
import RemoteModelCard from '../RemoteModelCard'

type Props = {
  queryText: string
}

const HubScreenFilter: React.FC<Props> = ({ queryText }) => {
  const { data } = useModelHub()

  if (!data) return null
  const builtInModels = data.modelCategories.get('BuiltInModels') ?? []
  const huggingFaceModels = data.modelCategories.get('HuggingFace') ?? []
  const remoteModels: HfModelEntry[] = []

  for (const [key, value] of data.modelCategories) {
    if (key !== 'HuggingFace' && key !== 'BuiltInModels') {
      remoteModels.push(...value)
    }
  }

  const filteredBuiltInModels = builtInModels.filter((model) => {
    return model.name.toLowerCase().includes(queryText.toLowerCase())
  })

  const filteredHuggingFaceModels = huggingFaceModels.filter((model) => {
    return model.name.toLowerCase().includes(queryText.toLowerCase())
  })

  const filteredRemoteModels = remoteModels.filter((model) => {
    return model.name.toLowerCase().includes(queryText.toLowerCase())
  })

  const isResultEmpty: boolean =
    filteredBuiltInModels.length === 0 &&
    filteredHuggingFaceModels.length === 0 &&
    filteredRemoteModels.length === 0

  const isOnDevice =
    filteredBuiltInModels.length > 0 || filteredHuggingFaceModels.length > 0

  return (
    <div className="h-full w-full overflow-x-hidden rounded-lg bg-[hsla(var(--app-bg))]">
      {isResultEmpty ? (
        <div className="py-6">
          <BlankState title="No search results found" />
        </div>
      ) : (
        <div className="mx-auto mt-6 flex h-full w-full max-w-[650px] flex-col gap-4 py-4">
          {isOnDevice && (
            <Fragment>
              <div className="mt-4 flex items-center gap-2 first:mt-0">
                <h1 className="text-lg font-semibold">On-Device Models</h1>
              </div>
              <div className="-mt-2 w-full">
                {filteredBuiltInModels.map((hfModelEntry) => (
                  <BuiltInModelCard key={hfModelEntry.id} {...hfModelEntry} />
                ))}
                {filteredHuggingFaceModels.map((hfModelEntry) => (
                  <HuggingFaceModelCard
                    key={hfModelEntry.id}
                    {...hfModelEntry}
                  />
                ))}
              </div>
            </Fragment>
          )}

          {filteredRemoteModels.length > 0 && (
            <Fragment>
              <div className="mt-4 flex items-center gap-2 first:mt-0">
                <h1 className="text-lg font-semibold">Cloud Models</h1>
              </div>
              <div className="w-full">
                {filteredRemoteModels.map((hfModelEntry) => (
                  <RemoteModelCard key={hfModelEntry.id} {...hfModelEntry} />
                ))}
              </div>
            </Fragment>
          )}
        </div>
      )}
    </div>
  )
}

export default HubScreenFilter
