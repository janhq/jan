import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useModelProvider } from '@/hooks/useModelProvider'
import { getProviderLogo } from '@/lib/utils'
import { useEffect } from 'react'
import Capabilities from './Capabilities'

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
          {providers.map((provider, index) => {
            const providerKey = Object.keys(provider)[0]
            const data = provider[providerKey]

            return (
              <div
                className="bg-main-view-fg/4 my-1.5 first:mt-0 rounded-sm pb-1"
                key={`remote-provider-${index}`}
              >
                <DropdownMenuLabel className="flex items-center gap-1">
                  <img
                    src={getProviderLogo(data.provider)}
                    alt={`${data.provider} - Logo`}
                  />
                  <span className="capitalize">
                    {data.provider === 'llamacpp' ? 'Llama.cpp' : data.provider}
                  </span>
                </DropdownMenuLabel>
                {data.models.map((model, modelIndex) => {
                  const modelKey = Object.keys(model)[0]
                  const modelData = model[modelKey]
                  const capabilities = modelData.copabilities || []

                  return (
                    <DropdownMenuItem
                      className="h-8 mx-1"
                      key={`remote-model-${modelIndex}`}
                    >
                      <div className="flex items-center justify-between w-full">
                        <span className="text-main-view-fg/70">{modelKey}</span>
                        <div className="-mr-1.5">
                          <Capabilities capabilities={capabilities} />
                        </div>
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
