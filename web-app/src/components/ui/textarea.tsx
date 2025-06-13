import * as React from 'react'

import { cn } from '@/lib/utils'

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'placeholder:text-main-view-fg/40 border-main-view-fg/10 flex field-sizing-content min-h-16 w-full rounded-md border bg-transparent px-3 py-2 shadow-xs transition-[color,box-shadow] outline-none disabled:cursor-not-allowed disabled:opacity-50 text-sm',
        'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[1px] ring-main-view-fg/10',
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
