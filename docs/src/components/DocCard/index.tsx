import React, { PropsWithChildren } from 'react'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'

type DocCardProps = {
  title: string
  href: string
  icon?: React.ReactNode
  iconClassName?: string
} & PropsWithChildren

export function DocCard({ title, href, icon, iconClassName, children }: DocCardProps) {
  const isExternal = href.startsWith('http')
  const Component = isExternal ? 'a' : Link

  return (
    <Component
      href={href}
      {...(isExternal ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      className="group flex flex-col gap-2 rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-neutral-900 p-5 hover:border-black/25 dark:hover:border-white/25 hover:shadow-sm transition-all no-underline"
    >
      {icon && (
        <div className={`mb-1 text-black/50 dark:text-white/50 ${iconClassName ?? ''}`}>{icon}</div>
      )}
      <div className="flex items-center justify-between">
        <span className="font-semibold text-black dark:text-white text-base leading-snug">
          {title}
        </span>
        <ArrowRight
          size={16}
          className="text-black/30 dark:text-white/30 group-hover:text-black/70 dark:group-hover:text-white/70 transition-colors shrink-0 ml-2"
        />
      </div>
      {children && (
        <p className="text-sm text-black/60 dark:text-white/60 leading-relaxed m-0">
          {children}
        </p>
      )}
    </Component>
  )
}

type DocCardsProps = {
  cols?: number
} & PropsWithChildren

export function DocCards({ cols = 2, children }: DocCardsProps) {
  return (
    <div
      className="grid gap-3 mt-4"
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
    >
      {children}
    </div>
  )
}
