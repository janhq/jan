/**
 * Drop-in replacements for the Nextra 2 MDX components the docs were written
 * with, so page bodies did not need rewriting during the Fumadocs move. They
 * now render in the jan.ai design system.
 *
 *   <Callout type="default|info|tip|warning|error" emoji?>
 *   <Steps> ... ### Step heading ... </Steps>   (each h3 = one numbered step)
 *   <Tabs items={[...]}><Tabs.Tab>...</Tabs.Tab></Tabs>
 *   <Link href=...>                              (nextra-theme-docs)
 *
 * New content can use the Fumadocs components directly.
 */
import type { ComponentProps, ReactNode } from 'react'
import { Info, Lightbulb, TriangleAlert, type LucideIcon } from 'lucide-react'
import { NextraTabs, NextraTab } from '@/components/nextra-tabs'
import { cn } from '@/lib/cn'

// ---- Callout (jan.ai's, from janhq/jan.ai src/components/ds/Callout) -----------
//
// A tinted card in one of the accent swatches: a round icon chip and a
// Mono/Badge label on top, then the content at 80%. Same 12px corners as code
// blocks. Inline code turns to the page colour, since grey sinks into the tint.
//
// type       label      accent
// (default)  Note       blue
// info       Note       blue
// tip        Tip        lime, green chip
// warning    Heads up   yellow
// error      Important  yellow

type Kind = 'default' | 'info' | 'tip' | 'warning' | 'error'

const KINDS: Record<Kind, { label: string; Icon: LucideIcon; card: string; chip: string }> = {
  default: { label: 'Note', Icon: Info, card: 'bg-jan-blue/10 dark:bg-jan-blue/15', chip: 'bg-jan-blue text-jan-neutral-0' },
  info: { label: 'Note', Icon: Info, card: 'bg-jan-blue/10 dark:bg-jan-blue/15', chip: 'bg-jan-blue text-jan-neutral-0' },
  tip: { label: 'Tip', Icon: Lightbulb, card: 'bg-jan-lime/40 dark:bg-jan-lime/10', chip: 'bg-jan-green text-jan-neutral-0' },
  warning: { label: 'Heads up', Icon: TriangleAlert, card: 'bg-jan-yellow/20 dark:bg-jan-yellow/10', chip: 'bg-jan-yellow text-jan-neutral-950' },
  error: { label: 'Important', Icon: TriangleAlert, card: 'bg-jan-yellow/20 dark:bg-jan-yellow/10', chip: 'bg-jan-yellow text-jan-neutral-950' },
}

export function Callout({
  type = 'default',
  children,
}: {
  type?: string
  /** Accepted for Nextra compatibility; the icon comes from `type` */
  emoji?: ReactNode
  children?: ReactNode
}) {
  const { label, Icon, card, chip } = KINDS[type as Kind] ?? KINDS.default
  return (
    <aside className={cn('jan-callout mt-6 rounded-xl px-5 py-4 md:px-6 md:py-5', card)}>
      <span className="flex items-center gap-2.5 font-mono text-mono-badge uppercase text-ink">
        <span aria-hidden className={cn('flex size-6 shrink-0 items-center justify-center rounded-full', chip)}>
          <Icon className="size-3.5" strokeWidth={2.25} />
        </span>
        {label}
      </span>
      <div className="mt-3 text-ink/80 [&>*+*]:!mt-3 [&>:first-child]:!mt-0 [&_:not(pre)>code]:!bg-page">
        {children}
      </div>
    </aside>
  )
}

// ---- Steps ---------------------------------------------------------------------

// Nextra numbers every h3 inside <Steps>; keep that authoring model.
export function Steps({ children, className }: { children?: ReactNode; className?: string }) {
  return <div className={cn('jan-steps', className)}>{children}</div>
}

// <Tabs.Tab> needs a static property, which a client module can't export to
// server components; attach it here (server side).
export const Tabs = Object.assign(NextraTabs, { Tab: NextraTab })

// ---- Link (nextra-theme-docs) ------------------------------------------------------

export function Link({ href = '#', children, ...props }: ComponentProps<'a'>) {
  return (
    <a href={href} {...props}>
      {children}
    </a>
  )
}
