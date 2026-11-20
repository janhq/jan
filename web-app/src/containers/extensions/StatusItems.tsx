import { useMemo } from 'react'
import type { StatusItemContribution } from '@janhq/extension-api'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { SidebarFooter } from '@/components/ui/sidebar'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useContributions } from '@/lib/extensions/contributions'
import { useLocalize } from '@/lib/extensions/l10n'
import { cn } from '@/lib/utils'
import { useExecuteCommand } from './useExecuteCommand'

interface StatusEntry {
  extensionId: string
  extensionName: string
  item: StatusItemContribution
}

/**
 * The sidebar footer row of status items contributed by extensions, highest
 * priority first; absent when there are none. Each one
 * names its extension in the tooltip; one with a command runs it on click.
 */
export function StatusItems({ className }: { className?: string }) {
  const { t } = useTranslation()
  const execute = useExecuteCommand()
  const extensions = useContributions((s) => s.extensions)
  const statusItems = useContributions((s) => s.statusItems)
  const localize = useLocalize()

  const entries = useMemo(
    () =>
      Object.entries(statusItems)
        .flatMap(([extensionId, items]): StatusEntry[] => {
          const extension = extensions[extensionId]
          if (!extension) return []
          return Object.values(items).map((item) => ({
            extensionId,
            extensionName: localize(extension, extension.displayName),
            item: {
              ...item,
              text: localize(extension, item.text),
              tooltip:
                item.tooltip === undefined
                  ? undefined
                  : localize(extension, item.tooltip),
            },
          }))
        })
        .sort((a, b) => (b.item.priority ?? 0) - (a.item.priority ?? 0)),
    [extensions, statusItems, localize]
  )

  if (entries.length === 0) return null
  return (
    <SidebarFooter
      className={cn('flex-row flex-wrap items-center gap-1', className)}
      data-testid="extension-status-items"
    >
      {entries.map(({ extensionId, extensionName, item }) => {
        const { command } = item
        const label = t('extensions:statusItemTooltip', {
          text: item.tooltip ?? item.text,
          extension: extensionName,
        })
        return (
          <Tooltip key={`${extensionId}/${item.id}`}>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={label}
                onClick={
                  command
                    ? () =>
                        void execute(extensionId, command, {
                          location: 'statusItem',
                        })
                    : undefined
                }
                className={cn(
                  'max-w-40 truncate rounded px-1.5 py-0.5 text-xs text-muted-foreground',
                  command
                    ? 'cursor-pointer hover:bg-sidebar-foreground/8'
                    : 'cursor-default'
                )}
              >
                {item.text}
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">{label}</TooltipContent>
          </Tooltip>
        )
      })}
    </SidebarFooter>
  )
}
