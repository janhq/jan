import { Button } from '@/components/ui/button'
import { useTranslation } from '@/i18n/react-i18next-compat'

/** Says why installed extensions are not running, with the way out. */
export function SafeModeBanner({ onTurnOff }: { onTurnOff: () => void }) {
  const { t } = useTranslation()
  return (
    <div
      role="status"
      className="flex items-center justify-between gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm"
    >
      <span>{t('extensions:safeMode.banner')}</span>
      <Button size="xs" variant="outline" onClick={onTurnOff}>
        {t('extensions:safeMode.turnOff')}
      </Button>
    </div>
  )
}
