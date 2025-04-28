import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useModelProvider } from '@/hooks/useModelProvider'
import { getProviderLogo } from '@/lib/utils'
import { useEffect } from 'react'
import { IconEye, IconTool, IconCode } from '@tabler/icons-react'

const DropdownModelProvider = () => {
  const { providers, fetchModelProvider } = useModelProvider()

  useEffect(() => {
    fetchModelProvider()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!providers.length) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="bg-main-view-fg/5 px-2 py-1 rounded">
          Default Model
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="w-60 max-h-[320px]"
        side="bottom"
        align="start"
      >
        <DropdownMenuGroup>
          {/* Local Model Providers */}
          <DropdownMenuLabel>Local Model</DropdownMenuLabel>
          {providers
            .filter((provider) => {
              const providerKey = Object.keys(provider)[0]
              return providerKey === 'llamacpp'
            })
            .map((provider, index) => {
              const providerKey = Object.keys(provider)[0]
              const providerData = provider[providerKey]

              return (
                <div
                  className="bg-main-view-fg/4 my-1 rounded-sm pb-1"
                  key={`local-provider-${index}`}
                >
                  <DropdownMenuLabel className="flex items-center gap-1">
                    <img
                      src={getProviderLogo(providerData.provider)}
                      alt={`${providerData.provider} - Logo`}
                    />
                    <span className="capitalize">{providerData.provider}</span>
                  </DropdownMenuLabel>
                  {providerData.models.map((model, modelIndex) => {
                    const modelKey = Object.keys(model)[0]
                    const modelData = model[modelKey]
                    const capabilities = modelData.copabilities || []

                    return (
                      <DropdownMenuItem
                        className="h-8 mx-1"
                        key={`local-model-${modelIndex}`}
                      >
                        <div className="flex items-center justify-between w-full">
                          <span>{modelKey}</span>
                          {capabilities.length > 0 && (
                            <div className="flex gap-1 mt-1">
                              {capabilities.map(
                                (capability: string, capIndex: number) => {
                                  let icon = null

                                  if (capability === 'vision') {
                                    icon = <IconEye size={14} />
                                  } else if (capability === 'tools') {
                                    icon = <IconTool size={14} />
                                  } else {
                                    icon = <IconCode size={14} />
                                  }

                                  return (
                                    <span
                                      key={`capability-${capIndex}`}
                                      className="flex items-center gap-1 text-xs px-1.5 py-0.5 bg-main-view-fg/5 rounded"
                                      title={capability}
                                    >
                                      {icon}
                                    </span>
                                  )
                                }
                              )}
                            </div>
                          )}
                        </div>
                      </DropdownMenuItem>
                    )
                  })}
                </div>
              )
            })}

          <DropdownMenuSeparator className="mt-2" />

          {/* Remote Model Providers */}
          <DropdownMenuLabel>Remote Model</DropdownMenuLabel>
          {providers
            .filter((provider) => {
              const providerKey = Object.keys(provider)[0]
              return providerKey !== 'llamacpp'
            })
            .map((provider, index) => {
              const providerKey = Object.keys(provider)[0]
              const providerData = provider[providerKey]

              return (
                <div
                  className="bg-main-view-fg/4 my-1 rounded-sm pb-1"
                  key={`remote-provider-${index}`}
                >
                  <DropdownMenuLabel className="flex items-center gap-1">
                    <img
                      src={getProviderLogo(providerData.provider)}
                      alt={`${providerData.provider} - Logo`}
                    />
                    <span className="capitalize">{providerData.provider}</span>
                  </DropdownMenuLabel>
                  {providerData.models.map((model, modelIndex) => {
                    const modelKey = Object.keys(model)[0]
                    const modelData = model[modelKey]
                    const capabilities = modelData.copabilities || []

                    return (
                      <DropdownMenuItem
                        className="h-8 mx-1"
                        key={`remote-model-${modelIndex}`}
                      >
                        <div className="flex items-center justify-between w-full">
                          <span>{modelKey}</span>
                          {capabilities.length > 0 && (
                            <div className="flex gap-1 mt-1">
                              {capabilities.map(
                                (capability: string, capIndex: number) => {
                                  let icon = null

                                  if (capability === 'vision') {
                                    icon = <IconEye size={14} />
                                  } else if (capability === 'tools') {
                                    icon = <IconTool size={14} />
                                  } else {
                                    icon = <IconCode size={14} />
                                  }

                                  return (
                                    <span
                                      key={`capability-${capIndex}`}
                                      className="flex items-center gap-1 text-xs px-1.5 py-0.5 bg-main-view-fg/5 rounded"
                                      title={capability}
                                    >
                                      {icon}
                                    </span>
                                  )
                                }
                              )}
                            </div>
                          )}
                        </div>
                      </DropdownMenuItem>
                    )
                  })}
                </div>
              )
            })}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export default DropdownModelProvider
