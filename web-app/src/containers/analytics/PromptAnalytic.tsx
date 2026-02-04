import { Button } from '@/components/ui/button'
import { useAnalytic } from '@/hooks/useAnalytic'
import { IconFileTextShield } from '@tabler/icons-react'
import posthog from 'posthog-js'
import { useTranslation } from '@/i18n/react-i18next-compat'

export function PromptAnalytic() {
  const { t } = useTranslation()
  const { setProductAnalyticPrompt, setProductAnalytic } = useAnalytic()

  const handleProductAnalytics = (isAllowed: boolean) => {
    if (isAllowed) {
      posthog.opt_in_capturing()
      setProductAnalytic(true)
      setProductAnalyticPrompt(false)
    } else {
      posthog.opt_out_capturing()
      setProductAnalytic(false)
      setProductAnalyticPrompt(false)
    }
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 p-4 shadow-lg bg-main-view w-4/5 md:w-100 border border-main-view-fg/8 rounded-lg">
      <div className="flex items-center gap-2">
        <IconFileTextShield className="text-accent" />
        <h2 className="font-medium text-main-view-fg/80">
          {t('helpUsImproveJan')}
        </h2>
      </div>
      <p className="mt-2 text-sm text-main-view-fg/70">
        We collect anonymous data to understand feature usage. Your chats and
        personal information are never tracked. You can change this anytime
        in&nbsp;
        <span className="font-medium text-main-view-fg">{`Settings > Privacy.`}</span>
      </p>
      <p className="mt-2 text-sm text-main-view-fg/80">
        Would you like to help us to improve Jan?
      </p>
      <div className="mt-4 flex justify-end space-x-2">
        <Button
          variant="link"
          className="text-main-view-fg/70"
          onClick={() => handleProductAnalytics(false)}
        >
          {t('deny')}
        </Button>
        <Button onClick={() => handleProductAnalytics(true)}>
          {t('allow')}
        </Button>
      </div>
    </div>
  )
}
