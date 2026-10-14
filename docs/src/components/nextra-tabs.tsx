'use client'
import * as RadixTabs from '@radix-ui/react-tabs'
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react'
import { cn } from '@/lib/cn'

// ---- Tabs (port of nextra/components Tabs, by position) -------------------------

type TabItem = string | { label: ReactNode; disabled?: boolean }

export function NextraTabs({
  items,
  defaultIndex = 0,
  children,
}: {
  items: TabItem[]
  defaultIndex?: number
  children?: ReactNode
}) {
  const panels = Children.toArray(children).filter(isValidElement) as ReactElement[]
  return (
    <RadixTabs.Root defaultValue={String(defaultIndex)} className="jan-tabs">
      <div className="overflow-x-auto overflow-y-hidden overscroll-x-contain">
        <RadixTabs.List className="mt-4 flex w-max min-w-full border-b border-[#e5e7eb] pb-px">
          {items.map((item, i) => {
            const label = typeof item === 'object' ? item.label : item
            const disabled = typeof item === 'object' && item.disabled
            return (
              <RadixTabs.Trigger
                key={i}
                value={String(i)}
                disabled={disabled}
                className={cn(
                  '-mb-0.5 mr-2 select-none rounded-t border-b-2 p-2 font-medium leading-5 transition-colors',
                  'border-transparent text-[#4b5563] hover:border-[#e5e7eb] hover:text-black',
                  'data-[state=active]:border-jan-blue data-[state=active]:text-jan-blue',
                  disabled && 'pointer-events-none text-[#9ca3af]'
                )}
              >
                {label}
              </RadixTabs.Trigger>
            )
          })}
        </RadixTabs.List>
      </div>
      {panels.map((panel, i) => (
        // Every panel is mounted (inactive ones hidden), as in the static
        // HTML of the old site, so headings inside tabs keep their anchors.
        <RadixTabs.Content
          key={i}
          value={String(i)}
          forceMount
          className="rounded pt-6 data-[state=inactive]:hidden"
        >
          {panel}
        </RadixTabs.Content>
      ))}
    </RadixTabs.Root>
  )
}

export function NextraTab({ children }: { children?: ReactNode }) {
  return <>{children}</>
}


