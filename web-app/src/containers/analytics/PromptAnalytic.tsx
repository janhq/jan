import { createPortal } from 'react-dom'
import { IconFileTextShield } from '@tabler/icons-react'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { AnalyticConsent } from './AnalyticConsent'

/**
 * Floating placement of the consent question, for users who are already past
 * onboarding. During first-run setup the wizard hosts the same question inline
 * under its own page heading.
 */
export function PromptAnalytic() {
  const { t } = useTranslation()

  return createPortal(
    <div className="fixed bottom-4 right-4 z-(--layer-floating) p-4 shadow-lg bg-background w-4/5 md:w-100 border rounded-lg">
      <div className="mb-2 flex items-center gap-2">
        <IconFileTextShield className="text-muted-foreground" />
        <h2 className="font-medium">{t('helpUsImproveJan')}</h2>
      </div>
      <AnalyticConsent />
    </div>,
    document.body
  )
}
