import React, { ReactNode } from 'react'

import * as SelectPrimitive from '@radix-ui/react-select'
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
} from '@radix-ui/react-icons'

import './styles.scss'
import { twMerge } from 'tailwind-merge'

type Props = {
  options?: { name: string; value: string }[]
  open?: boolean
  block?: boolean
  value?: string
  placeholder?: string
  disabled?: boolean
  containerPortal?: HTMLDivElement | undefined | null
  className?: string
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
  className,
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
      <SelectPrimitive.Content className="select__content">
        <SelectPrimitive.ScrollUpButton className="select__scroll-botom">
          <ChevronUpIcon />
        </SelectPrimitive.ScrollUpButton>
        <SelectPrimitive.Viewport className="select__viewport">
          {options &&
            options.map((item, i) => {
              return (
                <SelectPrimitive.Item
                  key={i}
                  className="select__item"
                  value={item.value}
                >
                  <SelectPrimitive.ItemText>
                    {item.name}
                  </SelectPrimitive.ItemText>
                  <SelectPrimitive.ItemIndicator className="select__item-indicator">
                    <CheckIcon />
                  </SelectPrimitive.ItemIndicator>
                </SelectPrimitive.Item>
              )
            })}
        </SelectPrimitive.Viewport>
        <SelectPrimitive.ScrollDownButton />
        <SelectPrimitive.Arrow />
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  </SelectPrimitive.Root>
)

export { Select }
