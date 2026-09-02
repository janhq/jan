import { memo } from 'react'
import { IconSparkles } from '@tabler/icons-react'
import { Shimmer } from '@/components/ai-elements/shimmer'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { type ToolCallBar } from '@/lib/toolPresentation'

export type SubagentToolWidgetProps = {
  bar: Extract<ToolCallBar, { variant: 'subagent' }>
}

/**
 * A `task` being dispatched: which subagent, and the brief it is being launched
 * with, as both stream in.
 *
 * Only shown while the call is in flight (`ToolCallCard` drops it once the call
 * settles). `task` returns the moment the child starts, so a settled card marks
 * a launch that is over, while the run it began goes on for minutes with the
 * tasks panel following it -- a card left open here would be a second, frozen
 * account of a run it had stopped watching. What the dispatch returned, a
 * refusal included, stays one click away inside the collapsed card.
 */
export const SubagentToolWidget = memo(
  ({ bar }: SubagentToolWidgetProps) => {
    const { t } = useTranslation()

    return (
      <div className="space-y-1.5">
        <div className="flex items-center gap-2 rounded-full border bg-card/40 px-3 py-1.5">
          <IconSparkles size={16} className="shrink-0 text-primary" />
          <span className="min-w-0 flex-1 truncate text-sm font-medium">
            {bar.name || (
              <span className="text-muted-foreground/60">
                {t('tools:toolCall.subagentPlaceholder')}
              </span>
            )}
          </span>
        </div>

        {bar.task && (
          <p className="line-clamp-3 px-2 text-sm text-muted-foreground">
            {bar.task}
          </p>
        )}

        <div className="px-2 text-sm">
          <Shimmer duration={1}>{t('tools:toolCall.dispatching')}</Shimmer>
        </div>
      </div>
    )
  }
)

SubagentToolWidget.displayName = 'SubagentToolWidget'
