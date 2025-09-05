import { Card } from './Card'
import { useModelProvider } from '@/hooks/useModelProvider'
import { Link } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import HeaderPage from './HeaderPage'
import { isProd } from '@/lib/version'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { localStorageKey } from '@/constants/localStorage'

function SetupScreen() {
  const { t } = useTranslation()
  const { providers } = useModelProvider()
  const firstItemRemoteProvider =
    providers.length > 0 ? providers[1]?.provider : 'openai'

  // Check if setup tour has been completed
  const isSetupCompleted =
    localStorage.getItem(localStorageKey.setupCompleted) === 'true'

  return (
    <div className="flex h-full flex-col flex-justify-center">
      <HeaderPage></HeaderPage>
      <div className="h-full px-8 overflow-y-auto flex flex-col gap-2 justify-center ">
        <div className="w-4/6 mx-auto">
          <div className="mb-8 text-left">
            <h1 className="font-editorialnew text-main-view-fg text-4xl">
              {t('setup:welcome')}
            </h1>
            <p className="text-main-view-fg/70 text-lg mt-2">
              {t('setup:description')}
            </p>
          </div>
          <div className="flex gap-4 flex-col">
            <Card
              header={
                <Link
                  to={route.hub.index}
                  search={{
                    ...(!isProd ? { step: 'setup_local_provider' } : {}),
                  }}
                >
                  <div>
                    <h1 className="text-main-view-fg font-medium text-base">
                      {t('setup:localModel')}
                    </h1>
                  </div>
                </Link>
              }
            ></Card>
            <Card
              header={
                <Link
                  to={route.settings.providers}
                  params={{
                    providerName: firstItemRemoteProvider,
                  }}
                  search={{
                    ...(!isSetupCompleted
                      ? { step: 'setup_remote_provider' }
                      : {}),
                  }}
                >
                  <h1 className="text-main-view-fg font-medium text-base">
                    {t('setup:remoteProvider')}
                  </h1>
                </Link>
              }
            ></Card>
          </div>
        </div>
      </div>
    </div>
  )
}

export default SetupScreen
