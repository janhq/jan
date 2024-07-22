import { Fragment } from 'react'

import React from 'react'

import Image from 'next/image'

import { Button } from '@janhq/joi'

import useModelHub from '@/hooks/useModelHub'

import { HfModelEntry } from '@/utils/huggingface'

import BuiltInModelCard from './BuiltInModelCard'

type Props = {
  onSeeAllClick: () => void
}

const BuiltInModelGroup: React.FC<Props> = ({ onSeeAllClick }) => {
  const { data } = useModelHub()
  if (!data) return null

  const models: HfModelEntry[] = (
    data.modelCategories.get('BuiltInModels') ?? []
  ).slice(0, 6)
  if (models.length === 0) return null

  return (
    <Fragment>
      <div className="mt-8 flex  items-center gap-2 first:mt-0">
        <Image
          width={24}
          height={24}
          src="icons/app_icon.svg"
          alt="Built-In Models"
        />
        <h1 className="text-lg font-semibold">Built-In Models</h1>
        <Button
          theme="ghost"
          onClick={onSeeAllClick}
          className="ml-auto pr-0 text-sm text-[hsla(var(--app-link))]"
        >
          See All
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-x-20 md:grid-cols-2">
        {models.map((model) => (
          <BuiltInModelCard key={model.name} {...model} />
        ))}
      </div>
    </Fragment>
  )
}

export default React.memo(BuiltInModelGroup)
