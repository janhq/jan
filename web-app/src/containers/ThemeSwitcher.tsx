import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useTheme } from '@/hooks/useTheme'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n/react-i18next-compat'
<<<<<<< HEAD
=======
import { ChevronsUpDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5

export function ThemeSwitcher() {
  const { t } = useTranslation()

  const themeOptions = [
    { value: 'dark', label: t('common:dark') },
    { value: 'light', label: t('common:light') },
    { value: 'auto', label: t('common:system') },
  ]

  const { setTheme, activeTheme } = useTheme()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
<<<<<<< HEAD
        <span
          title={t('common:editTheme')}
          className="flex cursor-pointer items-center gap-1 px-2 py-1 rounded-sm bg-main-view-fg/15 text-sm outline-none text-main-view-fg font-medium"
        >
          {themeOptions.find((item) => item.value === activeTheme)?.label ||
            t('common:auto')}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-24">
=======
        <Button variant="outline" size="sm" className="w-full justify-between" title={t('common:editTheme')}>
          {themeOptions.find(
            (item: { value: string; label: string }) => item.value === activeTheme
          )?.label || t('common:auto')}
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground ml-2" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
        {themeOptions.map((item) => (
          <DropdownMenuItem
            key={item.value}
            className={cn(
              'cursor-pointer my-0.5',
<<<<<<< HEAD
              activeTheme === item.value && 'bg-main-view-fg/5'
=======
              activeTheme === item.value && 'bg-secondary-foreground/8'
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
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
