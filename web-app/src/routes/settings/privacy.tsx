import { createFileRoute } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import SettingsMenu from '@/containers/SettingsMenu'
import HeaderPage from '@/containers/HeaderPage'
import { Switch } from '@/components/ui/switch'
import { Card, CardItem } from '@/containers/Card'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useAnalytic } from '@/hooks/useAnalytic'
import posthog from 'posthog-js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.settings.privacy as any)({
  component: Privacy,
})

function Privacy() {
  const { t } = useTranslation()
  const { setProductAnalytic, productAnalytic } = useAnalytic()

  return (
    <div className="flex flex-col h-svh w-full">
      <HeaderPage>
        <div className="flex items-center gap-2 w-full">
          <span className='font-medium text-base font-studio'>{t('common:settings')}</span>
        </div>
      </HeaderPage>
      <div className="flex h-[calc(100%-60px)]">
        <SettingsMenu />
        <div className="p-4 pt-0 w-full overflow-y-auto">
          <div className="flex flex-col justify-between gap-4 gap-y-3 w-full">
            <Card
              header={
                <div className="flex items-center justify-between mb-4">
                  <h1 className="font-medium text-foreground text-base">
                    {t('settings:privacy.analytics')}
                  </h1>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={productAnalytic}
                      onCheckedChange={(state) => {
                        if (state) {
                          posthog.opt_in_capturing()
                        } else {
                          posthog.opt_out_capturing()
                        }
                        setProductAnalytic(state)
                      }}
                    />
                  </div>
                </div>
              }
            >
              <CardItem
                title={t('settings:privacy.helpUsImprove')}
                description={<p>{t('settings:privacy.helpUsImproveDesc')}</p>}
                align="start"
              />
              <CardItem
                description={
                  <div className="text-foreground">
                    <p>{t('settings:privacy.privacyPolicy')}</p>
                    <p className="my-1">
                      {t('settings:privacy.analyticsDesc')}
                    </p>
                    <p>{t('settings:privacy.privacyPromises')}</p>
                    <ul className="list-disc pl-4 space-y-1 mt-4">
                      <li className="font-medium">
                        {t('settings:privacy.promise1')}
                      </li>
                      <li className="font-medium">
                        {t('settings:privacy.promise2')}
                      </li>
                      <li className="font-medium">
                        {t('settings:privacy.promise3')}
                      </li>
                      <li className="font-medium">
                        {t('settings:privacy.promise4')}
                      </li>
                      <li className="font-medium">
                        {t('settings:privacy.promise5')}
                      </li>
                    </ul>
                  </div>
                }
              />
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}
