'use client'

import * as SwitchPrimitives from '@radix-ui/react-switch'

import { twMerge } from 'tailwind-merge'
import { forwardRef, ElementRef, ComponentPropsWithoutRef } from 'react'

const Switch = forwardRef<
  ElementRef<typeof SwitchPrimitives.Root>,
  ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitives.Root
    className={twMerge('switch peer', className)}
    {...props}
    ref={ref}
  >
    <SwitchPrimitives.Thumb className={twMerge('switch-toggle')} />
  </SwitchPrimitives.Root>
))
Switch.displayName = SwitchPrimitives.Root.displayName

export { Switch }
