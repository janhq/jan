import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useModelProvider } from '@/hooks/useModelProvider'
import { getProviderLogo, getProviderTitle } from '@/lib/utils'
import { useEffect, useState } from 'react'
import Capabilities from './Capabilities'

type DropdownModelProviderProps = {
  threadData?: Thread
}

const DropdownModelProvider = ({ threadData }: DropdownModelProviderProps) => {
  const { providers, selectModelProvider, selectedProvider, selectedModel } =
    useModelProvider()
  const [displayModel, setDisplayModel] = useState<string>('')

  // Initialize model provider only once
  useEffect(() => {
    // Auto select model when existing thread is passed
    if (threadData) {
      selectModelProvider(
        threadData.model?.provider as string,
        threadData.model?.id as string
      )
    } else {
      // default model, we should add from setting
      selectModelProvider('llamacpp', 'qwen2.5:0.5b')
    }
  }, [threadData, selectModelProvider]) // Only run when threadData changes

  // Update display model when selection changes
  useEffect(() => {
    if (selectedProvider && selectedModel) {
      setDisplayModel(selectedModel)
    } else {
      setDisplayModel('Select a model')
    }
  }, [selectedProvider, selectedModel])

  if (!providers.length) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="bg-main-view-fg/5 hover:bg-main-view-fg/8 px-2 py-1 rounded font-medium cursor-pointer flex items-center gap-1.5">
          <img
            src={getProviderLogo(selectedProvider as string)}
            alt={`${selectedProvider} - Logo`}
            className="size-4"
          />
          <span className="text-main-view-fg/80">{displayModel}</span>
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
                key={`provider-${index}`}
              >
                <DropdownMenuLabel className="flex items-center gap-1">
                  <img
                    src={getProviderLogo(data.provider)}
                    alt={`${data.provider} - Logo`}
                    className="size-4"
                  />
                  <span className="capitalize">
                    {getProviderTitle(data.provider)}
                  </span>
                </DropdownMenuLabel>
                {data.models.map((model, modelIndex) => {
                  const modelKey = Object.keys(model)[0]
                  const modelData = model[modelKey]
                  const capabilities = modelData.copabilities || []

                  return (
                    <DropdownMenuItem
                      className="h-8 mx-1"
                      key={`model-${modelIndex}`}
                      onClick={() => selectModelProvider(providerKey, modelKey)}
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
