import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { fontSizeOptions, useInterfaceSettings } from '@/hooks/useInterfaceSettings'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { Button } from '@/components/ui/button'
import { ChevronsUpDown } from 'lucide-react'

export function FontSizeSwitcher() {
  const { fontSize, setFontSize } = useInterfaceSettings()
  const { t } = useTranslation()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="w-full justify-between" title={t('common:adjustFontSize')}>
          {fontSizeOptions.find(
            (item: { value: string; label: string }) => item.value === fontSize
          )?.label || t('common:medium')}
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground ml-2" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {fontSizeOptions.map((item: { value: string; label: string }) => (
          <DropdownMenuItem
            key={item.value}
            className={cn(
              'cursor-pointer my-0.5',
              fontSize === item.value && 'bg-secondary-foreground/8'
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
