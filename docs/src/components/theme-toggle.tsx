'use client'
import { useSyncExternalStore } from 'react'
import { MoonStar, Sun } from 'lucide-react'
import { useTheme } from 'fumadocs-ui/provider/base'
import { cn } from '@/lib/cn'

// One icon button that flips light ⇄ dark. It shows the current mode: a sun
// in light, a moon with stars in dark. First visits follow the system setting
// (provider.tsx). Before hydration it renders the sun, since the stored
// choice is only known in the browser.

const noop = () => () => {}

export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme()
  const mounted = useSyncExternalStore(noop, () => true, () => false)
  const dark = mounted && resolvedTheme === 'dark'
  const Icon = dark ? MoonStar : Sun

  return (
    <button
      type="button"
      onClick={() => setTheme(dark ? 'light' : 'dark')}
      aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      title={dark ? 'Light theme' : 'Dark theme'}
      className={cn(
        'focus-ring flex size-9 cursor-pointer items-center justify-center rounded-lg text-ink/60 transition-colors duration-150 ease-jan hover:text-ink',
        className
      )}
    >
      <Icon className="size-[18px]" strokeWidth={1.75} />
    </button>
  )
}
