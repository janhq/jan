import { useCallback, useState } from 'react'

import React from 'react'

import { Input, ScrollArea } from '@janhq/joi'
import { ArrowLeft, Search } from 'lucide-react'

import BlankState from '@/containers/BlankState'

import CenterPanelContainer from '@/containers/CenterPanelContainer'

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
    <CenterPanelContainer>
      <ScrollArea className="h-full w-full">
        <div className="mx-auto flex h-full w-full max-w-[650px] flex-col gap-6 p-6">
          <button
            onClick={onBackClicked}
            className="flex !w-fit items-center gap-1 !bg-transparent !text-[var(--text-secondary)]"
          >
            <ArrowLeft size={16} /> Back
          </button>
          <GroupInfo
            apiKeyUrl={apiKeyUrl}
            imageUrl={refinedImageUrl}
            category={category}
          />
          <div className="w-full md:w-1/2">
            <Input
              prefixIcon={<Search size={16} />}
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
            {!filteredModels.length ? (
              <div className="py-6">
                <BlankState title="No search results found" />
              </div>
            ) : (
              filteredModels.map((hfModelEntry) => {
                switch (category) {
                  case 'BuiltInModels':
                    return (
                      <BuiltInModelCard
                        key={hfModelEntry.id}
                        {...hfModelEntry}
                      />
                    )

                  case 'HuggingFace':
                    return (
                      <HuggingFaceModelCard
                        key={hfModelEntry.id}
                        {...hfModelEntry}
                      />
                    )
                  default:
                    return (
                      <RemoteModelCard
                        key={hfModelEntry.id}
                        {...hfModelEntry}
                      />
                    )
                }
              })
            )}
          </div>
        </div>
      </ScrollArea>
    </CenterPanelContainer>
  )
}

export default DetailModelGroup
