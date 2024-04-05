import { ReactNode } from 'react'

import { twMerge } from 'tailwind-merge'

type Props = {
  name?: string
  value: string | ReactNode
  titleBold?: boolean
}

export default function SystemItem({ name, value, titleBold }: Props) {
  return (
    <div className="flex items-center gap-x-1 text-xs">
      <p
        className={twMerge(
          titleBold ? 'font-semibold' : 'text-muted-foreground'
        )}
      >
        {name}
      </p>
      <span
        className={twMerge(
          titleBold ? 'text-muted-foreground' : 'font-semibold'
        )}
      >
        {value}
      </span>
    </div>
  )
}
