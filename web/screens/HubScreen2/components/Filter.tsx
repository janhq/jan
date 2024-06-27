import React, { useState } from 'react'

import { Button, Select } from '@janhq/joi'
import { Settings2 } from 'lucide-react'
import { twMerge } from 'tailwind-merge'

type Props = {
  callback: () => void
}

const Filter: React.FC<Props> = ({ callback }) => {
  const [selected, setSelected] = useState<
    'All' | 'OnDeviceModel' | 'CloudModel' | string
  >('All')

  const [selectPopular, setSelectPopular] = useState<string>('Most popular')

  const btns = [
    {
      name: 'All',
      select: 'All',
    },
    {
      name: 'On-device model',
      select: 'OnDeviceModel',
    },
    {
      name: 'Cloud model',
      select: 'CloudModel',
    },
  ]

  return (
    <div className="sticky top-0 flex flex-col justify-between gap-2 bg-[hsla(var(--app-bg))] pb-6 pt-4 md:flex-row">
      <div className="flex gap-[6px]">
        {btns.map((btn) => (
          <Button
            key={btn.name}
            className={twMerge(
              'border !bg-transparent text-[hsla(var(--text-primary))]',
              selected === btn.select && '!bg-[#0000000F]'
            )}
            onClick={() => setSelected(btn.select)}
          >
            {btn.name}
          </Button>
        ))}
      </div>
      <div className="flex gap-[6px]">
        <Select
          value={selectPopular}
          className="gap-1.5 px-4 py-2"
          options={[
            { name: 'Most popular', value: 'Most popular' },
            { name: 'Newest', value: 'Newest' },
          ]}
          onValueChange={(value) => setSelectPopular(value)}
        />
        <Button
          onClick={callback}
          className="border !bg-transparent text-[hsla(var(--text-primary))]"
        >
          <Settings2 size={16} />
        </Button>
      </div>
    </div>
  )
}

export default Filter
