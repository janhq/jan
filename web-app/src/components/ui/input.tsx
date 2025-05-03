import * as React from 'react'

import { cn } from '@/lib/utils'

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'placeholder:text-main-view-fg/40 border-main-view-fg/10 flex h-9 w-full min-w-0 rounded-md border bg-transparent px-3 py-1 shadow-xs transition-[color,box-shadow] outline-none disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 text-sm',
        'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[1px] ring-main-view-fg/10',
        'aria-invalid:ring-destructive/20 aria-invalid:border-destructive',
        '[&::-webkit-inner-spin-button]:appearance-none',
        className
      )}
      {...props}
    />
  )
}

export { Input }
