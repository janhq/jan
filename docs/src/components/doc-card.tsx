import type { PropsWithChildren, ReactNode } from 'react'
import { ArrowRight, ArrowUpRight } from 'lucide-react'
import { cn } from '@/lib/cn'

// Link card: an icon on a round neutral chip, then the title (15/24 SemiBold,
// well under the page's 22px h2), a one-phrase description at 60%, and a
// "Read →" call to action pinned to the bottom so a row of cards lines up. Cards that leave the docs say "Visit ↗".
// 1px line, 16px corners; on hover the card fills with the palest grey, the
// border darkens a step and the arrow nudges along.
type DocCardProps = {
  title: string
  href: string
  icon?: ReactNode
  iconClassName?: string
} & PropsWithChildren

export function DocCard({ title, href, icon, iconClassName, children }: DocCardProps) {
  const isExternal = href.startsWith('http')
  const Arrow = isExternal ? ArrowUpRight : ArrowRight

  return (
    <a
      href={href}
      {...(isExternal ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      className="group focus-ring not-prose flex flex-col rounded-2xl border border-line bg-page p-5 no-underline transition-colors duration-150 ease-jan hover:border-ink/15 hover:bg-surface"
    >
      {icon && (
        // The icon sits on a round neutral chip (palest grey, white while the
        // card itself turns grey on hover), in ink. Line icons only, brand
        // logos included (Tabler's outline marks, e.g. TbBrandDiscord), all at
        // the same 1.75 stroke.
        <span
          className={cn(
            'flex size-9 items-center justify-center rounded-full bg-surface text-ink transition-colors duration-150 ease-jan group-hover:bg-page [&_svg]:size-[18px] [&_svg]:stroke-[1.75]',
            iconClassName
          )}
        >
          {icon}
        </span>
      )}
      <span className={cn('text-[0.9375rem] font-semibold leading-6 text-ink', icon ? 'mt-4' : undefined)}>{title}</span>
      {children && <span className="mt-1 text-[0.9375rem] leading-6 text-ink/60">{children}</span>}
      <span className="mt-auto inline-flex items-center gap-1.5 pt-5 text-[0.9375rem] font-medium leading-6 text-ink">
        {isExternal ? 'Visit' : 'Read'}
        <Arrow
          aria-hidden
          className={cn(
            'size-4 transition-transform duration-150 ease-jan',
            isExternal
              ? 'motion-safe:group-hover:-translate-y-0.5 motion-safe:group-hover:translate-x-0.5'
              : 'motion-safe:group-hover:translate-x-0.5'
          )}
        />
      </span>
    </a>
  )
}

// 3 columns on wide screens, 2 on tablets, 1 on phones. `cols={2}` caps it at
// two (e.g. a pair of cards).
export function DocCards({ cols = 3, children }: { cols?: number } & PropsWithChildren) {
  return (
    <div className={cn('not-prose mt-6 grid gap-3 sm:grid-cols-2', cols >= 3 && 'lg:grid-cols-3')}>
      {children}
    </div>
  )
}
