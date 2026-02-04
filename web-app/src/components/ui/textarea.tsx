<<<<<<< HEAD
import * as React from 'react'

import { cn } from '@/lib/utils'

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
=======
import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
  return (
    <textarea
      data-slot="textarea"
      className={cn(
<<<<<<< HEAD
        'placeholder:text-main-view-fg/40 border-main-view-fg/10 flex field-sizing-content min-h-16 w-full rounded-md border bg-transparent px-3 py-2 shadow-xs transition-[color,box-shadow] outline-none disabled:cursor-not-allowed disabled:opacity-50 text-sm',
        'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[1px] ring-main-view-fg/10',
=======
        "border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:bg-input/30 flex field-sizing-content min-h-16 w-full rounded-md border bg-transparent px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
