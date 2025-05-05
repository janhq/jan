import * as React from 'react'
import * as SwitchPrimitive from '@radix-ui/react-switch'

import { cn } from '@/lib/utils'

function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        'peer cursor-pointer data-[state=checked]:bg-accent data-[state=unchecked]:bg-main-view-fg/20 focus-visible:border-none inline-flex h-[18px] w-8.5 shrink-0 items-center rounded-full border border-transparent shadow-xs transition-all outline-none focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          'bg-main-view pointer-events-none block size-4 rounded-full ring-0 transition-transform data-[state=checked]:translate-x-[calc(100%-1px)] data-[state=unchecked]:-translate-x-0'
        )}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
