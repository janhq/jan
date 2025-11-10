import * as React from 'react'
import { cn } from '@/lib/utils'

type CheckboxProps = React.ComponentProps<'input'>

function Checkbox({ className, ...props }: CheckboxProps) {
  return (
    <input
      type="checkbox"
      data-slot="checkbox"
      className={cn(
        'size-4 rounded-sm border border-main-view-fg/20 bg-transparent checked:bg-accent checked:border-accent focus-visible:outline-none focus-visible:ring-ring/40 focus-visible:ring-[2px] disabled:opacity-50 disabled:cursor-not-allowed',
        className
      )}
      {...props}
    />
  )
}

export { Checkbox }