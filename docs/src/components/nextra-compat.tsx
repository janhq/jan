/**
 * Drop-in replacements for the Nextra 2 MDX components the docs were written
 * with, so page bodies did not need rewriting during the Fumadocs move.
 *
 *   <Callout type="info|warning|tip|error|default">
 *   <Steps> ... ### Step heading ... </Steps>   (h3 = one numbered step)
 *   <Tabs items={[...]}><Tabs.Tab>...</Tabs.Tab></Tabs>
 *   <Link href=...>                              (nextra-theme-docs)
 *
 * New content can use the Fumadocs components directly.
 */
import { Callout as FdCallout } from 'fumadocs-ui/components/callout'
import { Tab, Tabs as FdTabs, type TabsProps } from 'fumadocs-ui/components/tabs'
import type { ComponentProps, ReactNode } from 'react'
import { cn } from '@/lib/cn'

type NextraCalloutType = 'default' | 'info' | 'warning' | 'error' | 'tip'

const CALLOUT_TYPE = {
  default: 'info',
  info: 'info',
  warning: 'warning',
  error: 'error',
  tip: 'idea',
} as const

export function Callout({
  type = 'default',
  emoji,
  children,
  ...props
}: {
  type?: NextraCalloutType
  emoji?: ReactNode
  title?: ReactNode
  children?: ReactNode
}) {
  return (
    <FdCallout
      type={CALLOUT_TYPE[type] ?? 'info'}
      icon={emoji ? <span>{emoji}</span> : undefined}
      className="jan-callout"
      {...props}
    >
      {children}
    </FdCallout>
  )
}

// Nextra numbers every h3 inside <Steps>; keep that authoring model.
export function Steps({ children, className }: { children?: ReactNode; className?: string }) {
  return <div className={cn('jan-steps', className)}>{children}</div>
}

function TabsImpl(props: TabsProps) {
  return <FdTabs {...props} />
}

// Nextra tabs are matched by position, not by value. Every panel is mounted
// (inactive ones hidden by CSS), as in Nextra, so headings inside tabs keep
// their anchors (#cpu-only-1) and the text is in the static HTML.
function NextraTab(props: ComponentProps<typeof Tab>) {
  return <Tab forceMount {...props} />
}

export const Tabs = Object.assign(TabsImpl, { Tab: NextraTab })

export function Link({ href = '#', children, ...props }: ComponentProps<'a'>) {
  return (
    <a href={href} {...props}>
      {children}
    </a>
  )
}
