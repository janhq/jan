/**
 * Drop-in replacements for the Nextra 2 MDX components the docs were written
 * with, rendering the same markup and look as jan.ai/docs did, so page bodies
 * did not need rewriting during the Fumadocs move.
 *
 *   <Callout type="default|info|warning|error" emoji?>   (Nextra 2 has no
 *     `tip`: it rendered as a plain bordered box, and still does)
 *   <Steps> ... ### Step heading ... </Steps>   (each h3 = one numbered step)
 *   <Tabs items={[...]}><Tabs.Tab>...</Tabs.Tab></Tabs>
 *   <Link href=...>                              (nextra-theme-docs)
 *
 * New content can use the Fumadocs components directly.
 */
import type { ComponentProps, ReactNode } from 'react'
import { NextraTabs, NextraTab } from '@/components/nextra-tabs'
import { cn } from '@/lib/cn'

// ---- Callout (port of nextra/components Callout, v2.13) ----------------------

function InformationCircleIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      width="20"
      height="20"
      className="mt-1"
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
      />
    </svg>
  )
}

const TYPE_TO_EMOJI: Record<string, ReactNode> = {
  default: '💡',
  error: '🚫',
  info: <InformationCircleIcon />,
  warning: '⚠️',
}

// Tailwind palette values Nextra used (orange/red/blue/yellow 50-900).
const TYPE_CLASSES: Record<string, string> = {
  default: 'border-[#ffedd5] bg-[#fff7ed] text-[#9a3412]',
  error: 'border-[#fecaca] bg-[#fee2e2] text-[#7f1d1d]',
  info: 'border-[#bfdbfe] bg-[#dbeafe] text-[#1e3a8a]',
  warning: 'border-[#fef9c3] bg-[#fefce8] text-[#713f12]',
}

export function Callout({
  type = 'default',
  emoji,
  children,
}: {
  type?: string
  emoji?: ReactNode
  children?: ReactNode
}) {
  return (
    <div
      className={cn(
        'jan-callout not-prose mt-6 flex overflow-x-auto rounded-lg border py-2 pr-4',
        TYPE_CLASSES[type] ?? 'border-[#e5e7eb] text-[#334155]'
      )}
    >
      <div
        className="select-none pl-3 pr-2 text-xl"
        style={{ fontFamily: '"Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol"' }}
      >
        {emoji ?? TYPE_TO_EMOJI[type]}
      </div>
      <div className="jan-callout-body w-full min-w-0 leading-7">{children}</div>
    </div>
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
