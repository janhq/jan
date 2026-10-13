import type { PropsWithChildren, ReactNode } from 'react'
import { ArrowRight } from 'lucide-react'

// Port of the old DocCard / DocCards (unchanged look).
type DocCardProps = {
  title: string
  href: string
  icon?: ReactNode
  iconClassName?: string
} & PropsWithChildren

export function DocCard({ title, href, icon, iconClassName, children }: DocCardProps) {
  const isExternal = href.startsWith('http')

  return (
    <a
      href={href}
      {...(isExternal ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      className="group not-prose flex flex-col gap-2 rounded-xl border border-black/10 bg-white p-5 no-underline transition-all hover:border-black/25 hover:shadow-sm"
    >
      {icon && <div className={`mb-1 text-black/50 ${iconClassName ?? ''}`}>{icon}</div>}
      <div className="flex items-center justify-between">
        <span className="text-base font-semibold leading-snug text-black">{title}</span>
        <ArrowRight
          size={16}
          className="ml-2 shrink-0 text-black/30 transition-colors group-hover:text-black/70"
        />
      </div>
      {children && <p className="m-0 text-sm leading-relaxed text-black/60">{children}</p>}
    </a>
  )
}

export function DocCards({ cols = 2, children }: { cols?: number } & PropsWithChildren) {
  return (
    <div
      className="not-prose mt-4 grid gap-3 max-sm:!grid-cols-1"
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
    >
      {children}
    </div>
  )
}
