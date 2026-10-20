import type { PropsWithChildren, ReactNode } from 'react'
import { ArrowRight, ArrowUpRight } from 'lucide-react'
import { cn } from '@/lib/cn'

// Link card: an icon on a round neutral chip, then the title (doc-body
// Medium), a one-phrase description (doc-small at 60%) and a "Read →" call
// to action pinned to the bottom so a row of cards lines up. Cards that leave the docs say "Visit ↗".
// 1px line, 12px corners; on hover the card fills with the palest grey, the
// border darkens a step and the arrow nudges along.
// Phones: a compact row (chip left, title and description beside it, a bare
// arrow on the right), so a group of cards takes half the scroll.
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
      className={cn(
        'group focus-ring not-prose grid items-center gap-x-4 rounded-xl border border-line bg-page p-4 no-underline transition-colors duration-150 ease-jan hover:border-ink/15 hover:bg-surface',
        'sm:flex sm:flex-col sm:items-stretch sm:p-5',
        icon ? 'grid-cols-[auto_1fr_auto]' : 'grid-cols-[1fr_auto]'
      )}
    >
      {icon && (
        // The icon sits on a round neutral chip (palest grey, white while the
        // card itself turns grey on hover), in ink. Company logos are solid;
        // everything else is a Lucide line icon, thinned to a 1.75 stroke (only
        // Lucide's: icon packs draw solid logos with a zero-width stroke that
        // a wider one would fatten).
        <span
          className={cn(
            'row-span-2 flex size-9 items-center justify-center rounded-full bg-surface text-ink transition-colors duration-150 ease-jan group-hover:bg-page [&_svg]:size-[18px] [&_svg.lucide]:stroke-[1.75]',
            iconClassName
          )}
        >
          {icon}
        </span>
      )}
      <span className={cn('self-end text-doc-body sm:self-auto font-medium text-ink', !children && 'row-span-2 self-center', icon ? 'sm:mt-4' : undefined)}>
        {title}
      </span>
      {children && <span className="self-start text-doc-small text-ink/60 sm:mt-1 sm:self-auto">{children}</span>}
      <span
        className={cn(
          'row-span-2 row-start-1 inline-flex items-center gap-1.5 text-doc-small font-medium text-ink sm:mt-auto sm:pt-5',
          icon ? 'col-start-3' : 'col-start-2'
        )}
      >
        <span className="max-sm:sr-only">{isExternal ? 'Visit' : 'Read'}</span>
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
