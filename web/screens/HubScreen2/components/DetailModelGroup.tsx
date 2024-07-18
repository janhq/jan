import { useCallback, useState } from 'react'

import React from 'react'

import { ArrowLeft, Search } from 'lucide-react'

import useModelHub, { ModelHubCategory } from '@/hooks/useModelHub'

import { HfModelEntry } from '@/utils/huggingface'

import { getLogoByCategory } from '@/utils/model-engine'

import BuiltInModelCard from './BuiltInModelCard'
import GroupInfo from './GroupInfo'
import HuggingFaceModelCard from './HuggingFaceModelCard'
import RemoteModelCard from './RemoteModelCard'

type Props = {
  category: ModelHubCategory
  onBackClicked: () => void
}

const DetailModelGroup: React.FC<Props> = ({ category, onBackClicked }) => {
  const [filter, setFilter] = useState('')
  const { data } = useModelHub()

  const onFilterChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setFilter(e.target.value)
    },
    []
  )

  if (!data) return null

  const modelEntries: HfModelEntry[] = []
  if (category === 'BuiltInModels') {
    modelEntries.push(...(data.modelCategories.get('BuiltInModels') ?? []))
  } else if (category === 'HuggingFace') {
    modelEntries.push(...(data.modelCategories.get('HuggingFace') ?? []))
  } else {
    Object.entries(data.modelCategories).forEach(([key, value]) => {
      if (key === category) {
        modelEntries.push(...value)
      }
    })
  }

  const refinedImageUrl =
    getLogoByCategory(category) ??
    modelEntries.find((entry) => entry.model?.metadata?.logo != null)?.model
      ?.metadata?.logo

  const apiKeyUrl: string | undefined = modelEntries.find(
    (entry) => entry.model?.metadata?.api_key_url != null
  )?.model?.metadata?.api_key_url

  const filteredModels =
    filter.trim().length > 0
      ? modelEntries.filter((model) =>
          model.name.toLowerCase().includes(filter.toLowerCase())
        )
      : modelEntries

  return (
    <div className="h-full w-full overflow-x-hidden rounded-lg bg-[hsla(var(--app-bg))]">
      <div className="mx-auto flex h-full w-full max-w-[650px] flex-col gap-6 py-6">
        <button
          onClick={onBackClicked}
          className="text- flex !w-fit items-center gap-1 !bg-transparent !text-[var(--text-secondary)]"
        >
          <ArrowLeft size={16} /> Back
        </button>
        <GroupInfo
          apiKeyUrl={apiKeyUrl}
          imageUrl={refinedImageUrl}
          category={category}
        />
        <div className="flex h-8 w-full max-w-[320px] items-center gap-2 rounded-md border bg-[hsla(var(--app-bg))] p-2">
          <Search size={16} />
          <input
            className="flex-1 outline-none"
            placeholder="Search"
            value={filter}
            onChange={onFilterChange}
          />
        </div>

        {/* <div>
          <Select
            value={selectPopular}
            className="gap-1.5 px-4 py-2"
            options={[
              { name: 'Most popular', value: 'Most popular' },
              { name: 'Newest', value: 'Newest' },
            ]}
            onValueChange={(value) => setSelectPopular(value)}
          />
        </div> */}

        <div className="flex flex-col">
          {filteredModels.map((model) => {
            switch (category) {
              case 'BuiltInModels':
                return <BuiltInModelCard key={model.name} {...model} />

              case 'HuggingFace':
                return <HuggingFaceModelCard key={model.id} {...model} />

              default:
                return <RemoteModelCard key={model.name} {...model} />
            }
          })}
        </div>
      </div>
    </div>
  )
}

export default DetailModelGroup
