import {
  Textarea,
  Tooltip,
  TooltipPortal,
  TooltipArrow,
  TooltipContent,
  TooltipTrigger,
} from '@janhq/uikit'

// import { useAtomValue } from 'jotai'

import { InfoIcon } from 'lucide-react'

// import useUpdateModelParameters from '@/hooks/useUpdateModelParameters'

// import { getActiveThreadIdAtom } from '@/helpers/atoms/Thread.atom'

type Props = {
  title: string
  name: string
  description: string
  placeholder: string
  value: string
  onBlur: () => void
  onChange: () => void
}

const ModelConfigInput: React.FC<Props> = ({
  title,
  name,
  value,
  description,
  placeholder,
  onChange,
  onBlur,
}) => {
  // const { updateModelParameter } = useUpdateModelParameters()
  // const threadId = useAtomValue(getActiveThreadIdAtom)

  // const onValueChanged = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
  //   if (!threadId) return

  //   updateModelParameter(threadId, name, e.target.value)
  // }

  return (
    <div className="flex flex-col">
      <div className="mb-4 flex items-center gap-x-2">
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
      <Textarea
        name={name}
        placeholder={placeholder}
        onChange={onChange}
        onBlur={onBlur}
      />
    </div>
  )
}

export default ModelConfigInput
