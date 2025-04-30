import { route } from '@/constants/routes'
import { useModelProvider } from '@/hooks/useModelProvider'
import { cn, getProviderLogo, getProviderTitle } from '@/lib/utils'
import { useNavigate, useMatches } from '@tanstack/react-router'

const ProvidersMenu = () => {
  const { providers } = useModelProvider()
  const navigate = useNavigate()
  const matches = useMatches()

  return (
    <div className="w-40 py-2 border-r border-main-view-fg/5 pb-10 overflow-y-auto">
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
                'flex px-2 items-center gap-1.5 cursor-pointer hover:bg-main-view-fg/5 py-1 w-full rounded [&.active]:bg-main-view-fg/5',
                isActive && 'bg-main-view-fg/5'
              )}
              onClick={() =>
                navigate({
                  to: route.settings.providers,
                  params: { providerName: provider.provider },
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
  )
}

export default ProvidersMenu
