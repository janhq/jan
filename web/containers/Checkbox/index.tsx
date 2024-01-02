/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react'

import {
  Switch,
  Tooltip,
  TooltipArrow,
  TooltipContent,
  TooltipPortal,
  TooltipTrigger,
} from '@janhq/uikit'

// import { useAtomValue } from 'jotai'

import { InfoIcon } from 'lucide-react'

// import useUpdateModelParameters from '@/hooks/useUpdateModelParameters'

// import { getActiveThreadIdAtom } from '@/helpers/atoms/Thread.atom'

type Props = {
  name: string
  title: string
  description: string
  value: boolean
  checked: boolean
  onBlur: () => void
  onChange: (e: boolean) => void
}

const Checkbox: React.FC<Props> = ({
  name,
  value,
  title,
  checked,
  description,
  onChange,
  onBlur,
}) => {
  // const { updateModelParameter } = useUpdateModelParameters()
  // const threadId = useAtomValue(getActiveThreadIdAtom)

  // const onCheckedChange = (checked: boolean) => {
  //   if (!threadId) return

  //   updateModelParameter(threadId, name, checked)
  // }

  return (
    <div className="flex justify-between">
      <div className="mb-1 flex items-center gap-x-2">
        <p className="text-sm font-semibold text-zinc-500 dark:text-gray-300">
          {title}
        </p>
        <Tooltip>
          <TooltipTrigger asChild>
            <InfoIcon size={16} className="flex-shrink-0 dark:text-gray-500" />
          </TooltipTrigger>
          <TooltipPortal>
            <TooltipContent side="top" className="max-w-[240px]">
              <span>{description}</span>
              <TooltipArrow />
            </TooltipContent>
          </TooltipPortal>
        </Tooltip>
      </div>

      <Switch
        name={name}
        checked={value !== undefined ? value : checked}
        onCheckedChange={(e) => onChange(e)}
        onBlur={onBlur}
      />
    </div>
  )
}

export default Checkbox
