import { createFileRoute } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import SettingsMenu from '@/containers/SettingsMenu'
import HeaderPage from '@/containers/HeaderPage'
import { Switch } from '@/components/ui/switch'
import { Card, CardItem } from '@/containers/Card'
import { useTranslation } from 'react-i18next'
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
    <div className="flex flex-col h-full">
      <HeaderPage>
        <h1 className="font-medium">{t('common.settings')}</h1>
      </HeaderPage>
      <div className="flex h-full w-full">
        <SettingsMenu />
        <div className="p-4 w-full h-[calc(100%-32px)] overflow-y-auto">
          <div className="flex flex-col justify-between gap-4 gap-y-3 w-full">
            <Card
              header={
                <div className="flex items-center justify-between mb-4">
                  <h1 className="text-main-view-fg font-medium text-base">
                    Analytics
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
                title="Help us improve"
                description={
                  <p>
                    By opting in, you help us make Jan better by sharing
                    anonymous data, like feature usage and user counts. Your
                    chats and personal information are never collected.
                  </p>
                }
                align="start"
              />
              <CardItem
                description={
                  <div className="text-main-view-fg/90">
                    <p>
                      We prioritize your control over your data. Learn more
                      about our Privacy Policy.
                    </p>
                    <p className="my-1">
                      To make Jan better, we need to understand how it’s used -
                      but only if you choose to help. You can change your Jan
                      Analytics settings anytime.
                    </p>
                    <p>
                      Your choice to opt-in or out doesn't change our core
                      privacy promises:
                    </p>
                    <ul className="list-disc pl-4 space-y-1 mt-4">
                      <li className="font-medium">Your chats are never read</li>
                      <li className="font-medium">
                        No personal information is collected
                      </li>
                      <li className="font-medium">
                        No accounts or logins required
                      </li>
                      <li className="font-medium">
                        We don’t access your files
                      </li>
                      <li className="font-medium">
                        Your chat history and settings stay on your device
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
