import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useTheme } from '@/hooks/useTheme'
import { cn } from '@/lib/utils'

export function ThemeSwitcher() {
  const themeOptions = [
    { value: 'dark', label: 'Dark' },
    { value: 'light', label: 'Light' },
    { value: 'auto', label: 'System' },
  ]

  const { setTheme, activeTheme } = useTheme()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <span
          title="Edit Theme"
          className="flex cursor-pointer items-center gap-1 px-2 py-1 rounded-sm bg-main-view-fg/15 text-sm outline-none text-main-view-fg font-medium"
        >
          {themeOptions.find((item) => item.value === activeTheme)?.label ||
            'Auto'}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-24">
        {themeOptions.map((item) => (
          <DropdownMenuItem
            key={item.value}
            className={cn(
              'cursor-pointer my-0.5',
              activeTheme === item.value && 'bg-main-view-fg/5'
            )}
            onClick={() => setTheme(item.value as 'auto' | 'light' | 'dark')}
          >
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
