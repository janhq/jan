import React, { ReactNode } from 'react'

import * as TabsPrimitive from '@radix-ui/react-tabs'

import { Tooltip } from '../Tooltip'

import './styles.scss'
import { twMerge } from 'tailwind-merge'

type TabsProps = {
  options: {
    name: string
    value: string
    disabled?: boolean
    tooltipContent?: string
  }[]
  children: ReactNode
  defaultValue?: string
  value: string
  onValueChange?: (value: string) => void
}

type TabsContentProps = {
  value: string
  children: ReactNode
  className?: string
}

const TabsContent = ({ value, children, className }: TabsContentProps) => {
  return (
    <TabsPrimitive.Content
      className={twMerge('tabs__content', className)}
      value={value}
    >
      {children}
    </TabsPrimitive.Content>
  )
}

const Tabs = ({
  options,
  children,
  defaultValue,
  value,
  onValueChange,
}: TabsProps) => (
  <TabsPrimitive.Root
    className="tabs"
    value={value}
    defaultValue={defaultValue}
    onValueChange={onValueChange}
  >
    <TabsPrimitive.List className="tabs__list">
      {options.map((option, i) => {
        return option.disabled ? (
          <Tooltip
            key={i}
            content={option.tooltipContent}
            trigger={
              <TabsPrimitive.Trigger
                key={i}
                className="tabs__trigger"
                value={option.value}
                disabled={option.disabled}
              >
                {option.name}
              </TabsPrimitive.Trigger>
            }
          />
        ) : (
          <TabsPrimitive.Trigger
            key={i}
            className="tabs__trigger"
            value={option.value}
            disabled={option.disabled}
          >
            {option.name}
          </TabsPrimitive.Trigger>
        )
      })}
    </TabsPrimitive.List>

    {children}
  </TabsPrimitive.Root>
)

export { Tabs, TabsContent }
