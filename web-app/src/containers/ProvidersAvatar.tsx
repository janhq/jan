import { getProviderLogo, getProviderTitle } from '@/lib/utils'

const ProvidersAvatar = ({ provider }: { provider: ProviderObject }) => {
  return (
    <>
      {getProviderLogo(provider.provider) === undefined ? (
<<<<<<< HEAD
        <div className="flex w-4.5 h-4.5 rounded-full border border-main-view-fg/20 items-center justify-center bg-main-view-fg/10">
=======
        <div className="flex size-4.5 rounded-full border items-center justify-center">
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
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
