import { useState } from 'react'

import React from 'react'

import { Select } from '@janhq/joi'
import { ArrowLeft } from 'lucide-react'

import useModelHub, { ModelHubCategory } from '@/hooks/useModelHub'

import { HfModelEntry } from '@/utils/huggingface'

import {
  getDescriptionByCategory,
  getLogoByCategory,
  getTitleByCategory,
} from '@/utils/model-engine'

import GroupInfo from './GroupInfo'
import HubModelCard from './HubModelCard'

type Props = {
  category: ModelHubCategory
  imageUrl?: string
  onBackClicked: () => void
}

const DetailModelGroup: React.FC<Props> = ({
  category,
  imageUrl,
  onBackClicked,
}) => {
  const [selectPopular, setSelectPopular] = useState<string>('Most popular')
  const { data } = useModelHub()
  if (!data) return null

  const models: HfModelEntry[] = data.modelCategories.get(category) ?? []
  const title = getTitleByCategory(category)
  const description = getDescriptionByCategory(category)
  const refinedImageUrl = imageUrl ?? getLogoByCategory(category)

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
          title={title}
          imageUrl={refinedImageUrl}
          subTitle={description}
        />
        <div>
          <Select
            value={selectPopular}
            className="gap-1.5 px-4 py-2"
            options={[
              { name: 'Most popular', value: 'Most popular' },
              { name: 'Newest', value: 'Newest' },
            ]}
            onValueChange={(value) => setSelectPopular(value)}
          />
        </div>
        <div className="flex flex-col">
          {models.map((model) => (
            <HubModelCard key={model.name} {...model} />
          ))}
        </div>
      </div>
    </div>
  )
}

export default DetailModelGroup
