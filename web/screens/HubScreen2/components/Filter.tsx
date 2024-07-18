import React from 'react'

import { Button } from '@janhq/joi'
import { twMerge } from 'tailwind-merge'

import { ModelFilter, ModelFilters } from '..'

type Props = {
  currentFilter: ModelFilter
  onFilterClicked: (filter: ModelFilter) => void
  callback: () => void
}

const Filter: React.FC<Props> = ({ currentFilter, onFilterClicked }) => (
  <div className="sticky top-0 flex gap-[6px] bg-[hsla(var(--app-bg))] py-4 md:flex-row">
    {ModelFilters.map((filter) => (
      <Button
        key={filter}
        theme="ghost"
        variant="outline"
        className={twMerge(
          currentFilter === filter &&
            '!border-none !bg-[hsla(var(--secondary-bg))]'
        )}
        onClick={() => onFilterClicked(filter)}
      >
        {filter}
      </Button>
    ))}
  </div>
)

export default Filter
