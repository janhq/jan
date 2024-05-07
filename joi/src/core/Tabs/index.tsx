import React, { ReactNode } from 'react'

import * as TabsPrimitive from '@radix-ui/react-tabs'

import './styles.scss'

type TabsProps = {
  options: { name: string; value: string }[]
  children: ReactNode
  defaultValue?: string
  value: string
  onValueChange?: (value: string) => void
}

type TabsContentProps = {
  value: string
  children: ReactNode
}

const TabsContent = ({ value, children }: TabsContentProps) => {
  return (
    <TabsPrimitive.Content className="tabs__content" value={value}>
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
        return (
          <TabsPrimitive.Trigger
            key={i}
            className="tabs__trigger"
            value={option.value}
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
