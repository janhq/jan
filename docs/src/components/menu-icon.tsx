import { cn } from '@/lib/cn'

// The phone menu button's look, shared by the navbar's own menu and the
// page-list trigger on doc pages: 44px tap target pulled 8px into the
// container's edge (as jan.ai's), ink at 60%, full on hover, no fill.
export const MENU_BUTTON =
  'focus-ring relative -mr-2 flex size-11 cursor-pointer items-center justify-center rounded-lg text-ink/60 transition-colors duration-150 ease-jan hover:text-ink'

/** Two lines that slide to the centre and turn 45° into an X (jan.ai's). */
export function MenuIcon({ open }: { open: boolean }) {
  const line = 'absolute left-0 h-[1.5px] w-full rounded-full bg-current transition-transform duration-300 ease-jan'
  return (
    <span aria-hidden className="relative block h-3 w-5">
      <span className={cn(line, 'top-0', open && 'translate-y-[5.25px] rotate-45')} />
      <span className={cn(line, 'bottom-0', open && '-translate-y-[5.25px] -rotate-45')} />
    </span>
  )
}
