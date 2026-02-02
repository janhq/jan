import { getProviderLogo, getProviderTitle } from '@/lib/utils'

const ProvidersAvatar = ({ provider }: { provider: ProviderObject }) => {
  return (
    <>
      {getProviderLogo(provider.provider) === undefined ? (
        <div className="flex size-4.5 rounded-full border items-center justify-center">
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
