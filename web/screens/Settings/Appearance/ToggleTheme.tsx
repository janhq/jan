import { useTheme } from 'next-themes'

import { motion as m } from 'framer-motion'
import { twMerge } from 'tailwind-merge'

const themeMenus = [{ name: 'light' }, { name: 'dark' }, { name: 'system' }]

export default function ToggleTheme() {
  const { theme: currentTheme, setTheme } = useTheme()

  return (
    <div className="flex items-center space-x-1">
      {themeMenus.map((theme, i) => {
        const isActive = currentTheme === theme.name
        return (
          <div className="relative" key={i}>
            <button
              className={twMerge(
                'px-2 py-1 font-semibold capitalize',
                !isActive && 'opacity-50'
              )}
              onClick={async () => {
                setTheme(theme.name)
              }}
            >
              {theme.name}
            </button>
            {isActive ? (
              <m.div
                className="absolute inset-0 h-full w-full rounded-md border border-primary/50 bg-primary/20"
                layoutId="active-theme-menu"
              />
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
