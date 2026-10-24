import { useTranslation } from '@/i18n/react-i18next-compat'

/** Marks a bundle nobody vouched for: installed from a file, not an index. */
export function UnverifiedBadge() {
  const { t } = useTranslation()
  return (
    <span className="bg-destructive/10 px-1 py-0.5 rounded text-destructive text-xs font-medium">
      {t('extensions:origin.unverified')}
    </span>
  )
}
