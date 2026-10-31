import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n/react-i18next-compat'
import type { HomeMode } from '@/hooks/useHomeMode'

type Props = {
  mode: HomeMode
  onChange: (mode: HomeMode) => void
}

/**
 * Chat | Cowork selector in the home composer's control row. It chooses what
 * the conversation about to be started will be; it is not navigation, and there
 * is no matching switch anywhere else.
 */
export function HomeModeToggle({ mode, onChange }: Props) {
  const { t } = useTranslation()
  const options: HomeMode[] = ['chat', 'cowork']
  return (
    <div
      role="radiogroup"
      aria-label={t('common:homeMode.label')}
      data-testid="home-mode-toggle"
      className="relative isolate grid h-9 w-[164px] @max-[520px]/composer:w-32 @max-[360px]/composer:w-28 shrink-0 grid-cols-2 items-center rounded-full bg-muted p-0.5 dark:bg-white/[0.04]"
    >
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute inset-y-0.5 left-0.5 -z-10 w-[calc(50%-2px)] rounded-full border border-border bg-background shadow-sm dark:border-white/[0.12] dark:bg-[#3b3b3b] dark:shadow-[0_1px_3px_rgba(0,0,0,0.2)] transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none',
          mode === 'cowork' && 'translate-x-full'
        )}
      />
      {options.map((value) => {
        const active = mode === value
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            data-testid={`home-mode-${value}`}
            onClick={() => onChange(value)}
            className={cn(
              'flex h-8 items-center justify-center rounded-full px-3 text-sm @max-[520px]/composer:px-2 @max-[360px]/composer:px-1 @max-[360px]/composer:text-xs font-medium text-muted-foreground transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none',
              active && 'text-foreground'
            )}
          >
            {t(`common:homeMode.${value}`)}
          </button>
        )
      })}
    </div>
  )
}
