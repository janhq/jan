import React, { PropsWithChildren, forwardRef } from 'react'
import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area'
import { twMerge } from 'tailwind-merge'

import './styles.scss'

type Props = {
  className?: string
} & PropsWithChildren

const ScrollArea = ({ className, children }: Props) => (
  <ScrollAreaPrimitive.Root
    type="scroll"
    className={twMerge('scroll-area__root', className)}
  >
    <ScrollAreaPrimitive.Viewport className="scroll-area__viewport">
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
)

export { ScrollArea }
