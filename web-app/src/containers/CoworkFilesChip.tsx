import { Files } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n/react-i18next-compat'

/**
 * Opens the files rail. Quiet until the session has a file to list -- an
 * attachment or an artifact -- like the changes and plan chips beside it.
 */
export function CoworkFilesChip({
  count,
  open,
  onToggle,
}: {
  count: number
  open: boolean
  onToggle: () => void
}) {
  const { t } = useTranslation()
  if (count === 0) return null

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="xs"
          aria-pressed={open}
          aria-label={t('common:files.a11y', { count })}
          onClick={onToggle}
          className={cn('shrink-0', open && 'text-primary')}
        >
          <Files className="size-3.5 shrink-0" />
          <span className="font-mono tabular-nums text-muted-foreground">
            {count}
          </span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>{t('common:files.title')}</TooltipContent>
    </Tooltip>
  )
}
