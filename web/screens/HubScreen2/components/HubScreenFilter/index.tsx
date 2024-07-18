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

  Object.entries(data.modelCategories).forEach(([key, value]) => {
    if (key !== 'HuggingFace' && key !== 'BuiltInModels') {
      remoteModels.push(...value)
    }
  })

  const filteredBuiltInModels = builtInModels.filter((model) => {
    return model.name.toLowerCase().includes(queryText.toLowerCase())
  })

  const filteredHuggingFaceModels = huggingFaceModels.filter((model) => {
    return model.name.toLowerCase().includes(queryText.toLowerCase())
  })

  const filteredRemoteModels = remoteModels.filter((model) => {
    return model.name.toLowerCase().includes(queryText.toLowerCase())
  })

  return (
    <div className="h-full w-full overflow-x-hidden rounded-lg bg-[hsla(var(--app-bg))]">
      <div className="mx-auto flex h-full w-full max-w-[650px] flex-col gap-6 py-6">
        {filteredBuiltInModels.map((model) => (
          <BuiltInModelCard key={model.name} {...model} />
        ))}
        {filteredHuggingFaceModels.map((model) => (
          <HuggingFaceModelCard key={model.id} {...model} />
        ))}
        {filteredRemoteModels.map((model) => (
          <RemoteModelCard key={model.name} {...model} />
        ))}
      </div>
    </div>
  )
}

export default HubScreenFilter
