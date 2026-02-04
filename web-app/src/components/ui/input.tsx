<<<<<<< HEAD
import * as React from 'react'

import { cn } from '@/lib/utils'

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
=======
import * as React from "react"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
<<<<<<< HEAD
        'placeholder:text-main-view-fg/40 border-main-view-fg/10 flex h-9 w-full min-w-0 rounded-md border bg-transparent px-3 py-1 shadow-xs transition-[color,box-shadow] outline-none disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 text-sm',
        'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[1px] ring-main-view-fg/10',
        'aria-invalid:ring-destructive/20 aria-invalid:border-destructive',
        '[&::-webkit-inner-spin-button]:appearance-none',
=======
        "file:text-foreground placeholder:text-muted-foreground dark:bg-input/30 border-input h-9 w-full min-w-0 rounded-md border bg-white px-3 py-1 text-base text-foreground caret-current shadow-xs transition-[color,box-shadow] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
        "aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
        className
      )}
      {...props}
    />
  )
}

export { Input }
