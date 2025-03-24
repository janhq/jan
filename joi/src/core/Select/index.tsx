import React from 'react'

import * as SelectPrimitive from '@radix-ui/react-select'
import { CheckIcon, ChevronDownIcon } from '@radix-ui/react-icons'

import './styles.scss'
import { twMerge } from 'tailwind-merge'

type Props = {
  options?: { name: string; value: string; recommend?: boolean }[]
  open?: boolean
  block?: boolean
  value?: string
  side?: 'top' | 'right' | 'bottom' | 'left'
  position?: 'item-aligned' | 'popper'
  placeholder?: string
  disabled?: boolean
  containerPortal?: HTMLDivElement | undefined | null
  className?: string
  sideOffset?: number
  onValueChange?: (value: string) => void
  onOpenChange?: (open: boolean) => void
}

const Select = ({
  placeholder,
  options,
  value,
  disabled,
  containerPortal,
  block,
  sideOffset,
  position,
  className,
  side,
  open,
  onValueChange,
  onOpenChange,
}: Props) => (
  <SelectPrimitive.Root
    open={open}
    onValueChange={onValueChange}
    value={value}
    onOpenChange={onOpenChange}
  >
    <SelectPrimitive.Trigger
      className={twMerge(
        'select',
        className,
        disabled && 'select__disabled',
        block && 'w-full'
      )}
    >
      <SelectPrimitive.Value placeholder={placeholder} />
      <SelectPrimitive.Icon className="select__icon">
        <ChevronDownIcon />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>

    <SelectPrimitive.Portal container={containerPortal}>
      <SelectPrimitive.Content
        side={side}
        position={position}
        sideOffset={sideOffset}
        className="select__content"
      >
        <SelectPrimitive.Viewport className="select__viewport">
          {options &&
            options.map((item, i) => {
              return (
                <SelectPrimitive.Item
                  key={i}
                  className="select__item"
                  value={item.value}
                >
                  <div className="flex items-center gap-x-2">
                    <SelectPrimitive.ItemText>
                      <span>{item.name}</span>
                    </SelectPrimitive.ItemText>
                    {item.recommend && (
                      <span className="rounded bg-[hsla(var(--secondary-bg))] px-2 py-0.5 text-xs font-medium">
                        Recommended
                      </span>
                    )}
                  </div>
                  <SelectPrimitive.ItemIndicator className="select__item-indicator">
                    <CheckIcon />
                  </SelectPrimitive.ItemIndicator>
                </SelectPrimitive.Item>
              )
            })}
        </SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  </SelectPrimitive.Root>
)

export { Select }
