import { getProviderLogo, getProviderTitle } from '@/lib/utils'

const ProvidersAvatar = ({ provider }: { provider: ProviderObject }) => {
  return (
    <>
      {getProviderLogo(provider.provider) === undefined ? (
        <div className="flex w-4.5 h-4.5 rounded-full border border-main-view-fg/20 items-center justify-center bg-main-view-fg/10">
          <p className="text-xs leading-0 capitalize">
            {getProviderTitle(provider.provider).charAt(0)}
          </p>
        </div>
      ) : (
        <img
          src={getProviderLogo(provider.provider)}
          alt={`${provider.provider} - Logo`}
          className="size-4.5 object-contain rounded-full"
          style={{
            imageRendering: '-webkit-optimize-contrast',
          }}
          loading="eager"
          decoding="sync"
          draggable={false}
        />
      )}
    </>
  )
}

export default ProvidersAvatar
