import React, { PropsWithChildren, forwardRef } from 'react'
import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area'
import { twMerge } from 'tailwind-merge'

import './styles.scss'

const ScrollArea = React.forwardRef<
  React.ElementRef<typeof ScrollAreaPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Root>
>(({ className, children, ...props }, ref) => (
  <ScrollAreaPrimitive.Root
    type="scroll"
    className={twMerge('scroll-area__root', className)}
    {...props}
  >
    <ScrollAreaPrimitive.Viewport className="scroll-area__viewport" ref={ref}>
      {children}
    </ScrollAreaPrimitive.Viewport>
    <ScrollAreaPrimitive.Scrollbar
      className="scroll-area__bar"
      orientation="horizontal"
    >
      <ScrollAreaPrimitive.Thumb />
    </ScrollAreaPrimitive.Scrollbar>
    <ScrollAreaPrimitive.Scrollbar
      className="scroll-area__bar"
      orientation="vertical"
    >
      <ScrollAreaPrimitive.Thumb className="scroll-area__thumb" />
    </ScrollAreaPrimitive.Scrollbar>
    <ScrollAreaPrimitive.Corner className="scroll-area__corner" />
  </ScrollAreaPrimitive.Root>
))

export { ScrollArea }
