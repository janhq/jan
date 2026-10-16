import { ArrowDownAZ } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useInterfaceSettings } from '@/hooks/useInterfaceSettings'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { cn } from '@/lib/utils'

/**
 * Toggles listing models by name. The setting is shared, so the model picker
 * and the provider settings page always agree on the order.
 */
export function SortModelsByNameToggle({ className }: { className?: string }) {
  const { t } = useTranslation()
  const sortModelsByName = useInterfaceSettings((s) => s.sortModelsByName)
  const setSortModelsByName = useInterfaceSettings((s) => s.setSortModelsByName)
  const label = t('common:sortModelsByName')

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          aria-label={label}
          aria-pressed={sortModelsByName}
          onClick={() => setSortModelsByName(!sortModelsByName)}
          className={cn(
            sortModelsByName ? 'text-foreground' : 'text-muted-foreground',
            className
          )}
        >
          <ArrowDownAZ />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
