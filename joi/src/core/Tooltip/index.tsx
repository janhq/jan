import React, { ReactNode } from 'react'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'

import './styles.scss'

export interface TooltipProps {
  trigger?: ReactNode
  content: ReactNode
  side?: 'top' | 'right' | 'bottom' | 'left'
  open?: boolean
  disabled?: boolean
  withArrow?: boolean
  onOpenChange?: (open: boolean) => void
}

export const Tooltip = ({
  trigger,
  disabled,
  content,
  side = 'top',
  withArrow = true,
  open,
  onOpenChange,
}: TooltipProps) => {
  return (
    <TooltipPrimitive.Provider>
      <TooltipPrimitive.Root
        delayDuration={200}
        open={open}
        onOpenChange={onOpenChange}
      >
        <TooltipPrimitive.Trigger asChild className="tooltip__trigger">
          {trigger}
        </TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          {!disabled && content && (
            <TooltipPrimitive.Content
              className="tooltip__content"
              collisionPadding={16}
              sideOffset={6}
              side={side}
            >
              {content}
              {withArrow && (
                <TooltipPrimitive.Arrow className="tooltip__arrow" />
              )}
            </TooltipPrimitive.Content>
          )}
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  )
}
