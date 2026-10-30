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
      className="inline-flex shrink-0 items-center rounded-full bg-secondary/60 p-0.5 text-xs"
    >
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
              'rounded-full px-3 py-1 font-medium text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              active && 'bg-background text-foreground shadow-sm'
            )}
          >
            {t(`common:homeMode.${value}`)}
          </button>
        )
      })}
    </div>
  )
}
