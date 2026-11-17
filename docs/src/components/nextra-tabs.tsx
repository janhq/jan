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
        {/* doc-label tabs on a rule, like jan.ai's filter tabs: the
            selected tab at full ink with an ink underline, the rest at 60%. */}
        <RadixTabs.List className="flex w-max min-w-full gap-5 border-b border-line">
          {items.map((item, i) => {
            const label = typeof item === 'object' ? item.label : item
            const disabled = typeof item === 'object' && item.disabled
            return (
              <RadixTabs.Trigger
                key={i}
                value={String(i)}
                disabled={disabled}
                className={cn(
                  'focus-ring -mb-px select-none border-b-2 pb-2.5 pt-1 font-mono text-doc-label uppercase transition-colors duration-150 ease-jan',
                  'border-transparent text-ink/60 hover:text-ink',
                  'data-[state=active]:border-ink data-[state=active]:text-ink',
                  disabled && 'pointer-events-none text-ink/40'
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
          className="pt-6 data-[state=inactive]:hidden [&>:first-child]:!mt-0"
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


