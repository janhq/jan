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
<<<<<<< HEAD
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
=======
    <div className="fixed bottom-4 right-4 z-50 p-4 shadow-lg bg-background w-4/5 md:w-100 border rounded-lg">
      <div className="flex items-center gap-2">
        <IconFileTextShield className="text-muted-foreground" />
        <h2 className="font-medium">
          {t('helpUsImproveJan')}
        </h2>
      </div>
      <p className="mt-2 text-xs text-muted-foreground leading-normal">
        We collect anonymous data to understand feature usage. Your chats and
        personal information are never tracked. You can change this anytime
        in&nbsp;
        <span className="font-medium text-muted-foreground">{`Settings > Privacy.`}</span>
      </p>
      <p className="mt-2 text-sm">
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
        Would you like to help us to improve Jan?
      </p>
      <div className="mt-4 flex justify-end space-x-2">
        <Button
<<<<<<< HEAD
          variant="link"
          className="text-main-view-fg/70"
=======
          variant="ghost"
          size="sm"
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
          onClick={() => handleProductAnalytics(false)}
        >
          {t('deny')}
        </Button>
<<<<<<< HEAD
        <Button onClick={() => handleProductAnalytics(true)}>
=======
        <Button
          size="sm"
          onClick={() => handleProductAnalytics(true)}
        >
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
          {t('allow')}
        </Button>
      </div>
    </div>
  )
}
