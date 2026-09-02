import { memo } from 'react'
import type { ToolUIPart } from 'ai'
import { IconSparkles } from '@tabler/icons-react'
import { Shimmer } from '@/components/ai-elements/shimmer'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { isToolRunning, type ToolCallBar } from '@/lib/toolPresentation'

export type SubagentToolWidgetProps = {
  bar: Extract<ToolCallBar, { variant: 'subagent' }>
  state: ToolUIPart['state']
  errorText?: string
}

/**
 * A `task` call: which subagent was launched, and the brief it was launched
 * with.
 *
 * Deliberately says nothing about how the child is getting on. `task` returns
 * as soon as the child starts, so this card settles within a second of being
 * drawn, while the run it started goes on for minutes -- and the tasks panel
 * follows that for its whole life. A card that also tried to report progress
 * would be reporting a run it stopped watching.
 *
 * The result text is not shown either: it is a sentence addressed to the model
 * ("keep working rather than waiting for it"), and the file it names is only
 * useful to the model. A failed dispatch *is* shown, because a rejected call
 * is the one thing here the user may need to act on.
 */
export const SubagentToolWidget = memo(
  ({ bar, state, errorText }: SubagentToolWidgetProps) => {
    const { t } = useTranslation()
    const running = isToolRunning(state)

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

        {errorText ? (
          <div className="rounded-md bg-destructive/10 px-2 py-1.5 text-sm text-destructive">
            {errorText}
          </div>
        ) : running ? (
          <div className="px-2 text-sm">
            <Shimmer duration={1}>{t('tools:toolCall.dispatching')}</Shimmer>
          </div>
        ) : (
          <p className="px-2 text-sm text-muted-foreground/70">
            {t('tools:toolCall.subagentRunning')}
          </p>
        )}
      </div>
    )
  }
)

SubagentToolWidget.displayName = 'SubagentToolWidget'
