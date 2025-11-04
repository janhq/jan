import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { fontSizeOptions, useInterfaceSettings } from '@/hooks/useInterfaceSettings'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n/react-i18next-compat'

export function FontSizeSwitcher() {
  const { fontSize, setFontSize } = useInterfaceSettings()
  const { t } = useTranslation()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <span
          title={t('common:adjustFontSize')}
          className="flex cursor-pointer items-center gap-1 px-2 py-1 rounded-sm bg-main-view-fg/15 text-sm outline-none text-main-view-fg font-medium"
        >
          {fontSizeOptions.find(
            (item: { value: string; label: string }) => item.value === fontSize
          )?.label || t('common:medium')}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-24">
        {fontSizeOptions.map((item: { value: string; label: string }) => (
          <DropdownMenuItem
            key={item.value}
            className={cn(
              'cursor-pointer my-0.5',
              fontSize === item.value && 'bg-main-view-fg/5'
            )}
            onClick={() => setFontSize(item.value as FontSize)}
          >
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
