import { route } from '@/constants/routes'
import { useModelProvider } from '@/hooks/useModelProvider'
import { cn, getProviderLogo, getProviderTitle } from '@/lib/utils'
import { useNavigate, useMatches, Link } from '@tanstack/react-router'
import { IconArrowLeft } from '@tabler/icons-react'

const ProvidersMenu = ({
  stepSetupRemoteProvider,
}: {
  stepSetupRemoteProvider: boolean
}) => {
  const { providers } = useModelProvider()
  const navigate = useNavigate()
  const matches = useMatches()

  return (
    <div className="w-44 py-2 border-r border-main-view-fg/5 pb-10 overflow-y-auto">
      <Link to={route.settings.general}>
        <div className="flex items-center gap-0.5 ml-3 mb-4 mt-1">
          <IconArrowLeft size={16} className="text-main-view-fg/70" />
          <span className="text-main-view-fg/80">Back</span>
        </div>
      </Link>
      <div className="first-step-setup-remote-provider">
        {providers.map((provider, index) => {
          const isActive = matches.some(
            (match) =>
              match.routeId === '/settings/providers/$providerName' &&
              'providerName' in match.params &&
              match.params.providerName === provider.provider
          )

          return (
            <div key={index} className="flex flex-col px-2 my-1.5 ">
              <div
                className={cn(
                  'flex px-2 items-center gap-1.5 cursor-pointer hover:bg-main-view-fg/5 py-1 w-full rounded [&.active]:bg-main-view-fg/5 text-main-view-fg/80',
                  isActive && 'bg-main-view-fg/5',
                  // hidden for llama.cpp provider for setup remote provider
                  provider.provider === 'llama.cpp' &&
                    stepSetupRemoteProvider &&
                    'hidden'
                )}
                onClick={() =>
                  navigate({
                    to: route.settings.providers,
                    params: {
                      providerName: provider.provider,
                    },
                    ...(stepSetupRemoteProvider
                      ? { search: { step: 'setup_remote_provider' } }
                      : {}),
                  })
                }
              >
                <img
                  src={getProviderLogo(provider.provider)}
                  alt={`${provider.provider} - Logo`}
                  className="size-4"
                />
                <span className="capitalize">
                  {getProviderTitle(provider.provider)}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default ProvidersMenu
