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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'

export function FontSizeSwitcher({
  renderAsRadio = false,
}: {
  renderAsRadio?: boolean
}) {
  const { fontSize, setFontSize } = useInterfaceSettings()
  const { t } = useTranslation()

  if (renderAsRadio) {
    return (
      <RadioGroup
        value={fontSize}
        onValueChange={(value) => setFontSize(value as FontSize)}
        className="grid grid-cols-1 gap-3"
      >
        {fontSizeOptions.map((item) => (
          <Label
            key={item.value}
            htmlFor={item.value}
            className="cursor-pointer [&:has([data-state=checked])>div]:border-primary [&:has([data-state=checked])>div]:bg-primary/5"
          >
            <Card className="w-full border transition-colors shadow-none">
              <CardContent className="flex flex-row items-center justify-start gap-4 p-4">
                <RadioGroupItem value={item.value} id={item.value} />
                <span className="text-sm font-medium">{item.label}</span>
              </CardContent>
            </Card>
          </Label>
        ))}
      </RadioGroup>
    )
  }

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
