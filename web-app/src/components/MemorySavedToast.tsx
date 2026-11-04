import { Link } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import { useTranslation } from '@/i18n/react-i18next-compat'

/** Rendered inside the app's Toaster, retaining its router/i18n context. */
export function MemorySavedToast() {
  const { t } = useTranslation()
  return (
    <div className="flex items-center gap-4">
      <span>
        {t('common:memoryFeedback.saved', { defaultValue: 'Memory saved' })}
      </span>
      <Link
        to={route.settings.cowork}
        aria-label={t('common:memoryFeedback.inspectLabel', {
          defaultValue: 'Inspect saved memory',
        })}
        className="shrink-0 rounded-sm text-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4"
      >
        {t('common:memoryFeedback.inspect', { defaultValue: 'Inspect' })}
      </Link>
    </div>
  )
}
