import { Card } from './Card'
import { useModelProvider } from '@/hooks/useModelProvider'
import { Link } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import HeaderPage from './HeaderPage'
import { isProd } from '@/lib/version'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { localStorageKey } from '@/constants/localStorage'
import { PlatformFeatures } from '@/lib/platform/const'
import { PlatformFeature } from '@/lib/platform'

function SetupScreen() {
  const { t } = useTranslation()
  const { providers } = useModelProvider()
  const firstItemRemoteProvider =
    providers.length > 0 ? providers[1]?.provider : 'openai'

  // Check if setup tour has been completed
  const isSetupCompleted =
    localStorage.getItem(localStorageKey.setupCompleted) === 'true'

  return (
    <div className="flex h-full flex-col justify-center">
      <HeaderPage></HeaderPage>
      <div className="h-full px-8 overflow-y-auto flex flex-col gap-2 justify-center ">
        <div className="w-full lg:w-4/6 mx-auto">
          <div className="mb-8 text-left">
            <h1 className="font-editorialnew text-main-view-fg text-4xl">
              {t('setup:welcome')}
            </h1>
            <p className="text-main-view-fg/70 text-lg mt-2">
              {t('setup:description')}
            </p>
          </div>
          <div className="flex gap-4 flex-col">
            {/* Quick Start Button - Highlighted */}
            {PlatformFeatures[PlatformFeature.LOCAL_INFERENCE] && (
              <button
                onClick={() => {
                  // TODO: Phase 2 - Implement Jan Model V2 download and loading
                  console.log('Quick start with Jan Model clicked')
                }}
                className="w-full text-left"
              >
                <div className="bg-gradient-to-r from-blue-500/20 to-purple-500/20 p-5 rounded-lg border-2 border-blue-500/50 hover:border-blue-500/70 transition-all hover:shadow-lg">
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 w-10 h-10 bg-blue-500 rounded-lg flex items-center justify-center">
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        className="h-6 w-6 text-white"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M13 10V3L4 14h7v7l9-11h-7z"
                        />
                      </svg>
                    </div>
                    <div className="flex-1">
                      <h1 className="text-main-view-fg font-semibold text-lg mb-1">
                        {t('setup:quickStart')}
                      </h1>
                      <p className="text-main-view-fg/70 text-sm">
                        {t('setup:quickStartDescription')}
                      </p>
                    </div>
                  </div>
                </div>
              </button>
            )}

            {/* "or" divider */}
            {PlatformFeatures[PlatformFeature.LOCAL_INFERENCE] && (
              <div className="flex items-center gap-3">
                <div className="flex-1 h-px bg-main-view-fg/10"></div>
                <span className="text-main-view-fg/50 text-sm font-medium">
                  {t('setup:orDivider')}
                </span>
                <div className="flex-1 h-px bg-main-view-fg/10"></div>
              </div>
            )}

            {/* Set up local model */}
            {PlatformFeatures[PlatformFeature.LOCAL_INFERENCE] && (
              <Link
                to={route.hub.index}
                search={{
                  ...(!isProd ? { step: 'setup_local_provider' } : {}),
                }}
              >
                <Card
                  header={
                    <div>
                      <h1 className="text-main-view-fg font-medium text-base">
                        {t('setup:localModel')}
                      </h1>
                    </div>
                  }
                />
              </Link>
            )}

            {/* Set up remote provider */}
            <Link
              to={route.settings.providers}
              params={{
                providerName: firstItemRemoteProvider,
              }}
              search={{
                ...(!isSetupCompleted ? { step: 'setup_remote_provider' } : {}),
              }}
            >
              <Card
                header={
                  <h1 className="text-main-view-fg font-medium text-base">
                    {t('setup:remoteProvider')}
                  </h1>
                }
              />
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}

export default SetupScreen
