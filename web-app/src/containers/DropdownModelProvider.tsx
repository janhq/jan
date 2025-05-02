import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useModelProvider } from '@/hooks/useModelProvider'
import { cn, getProviderLogo, getProviderTitle } from '@/lib/utils'
import { useEffect, useState } from 'react'
import Capabilities from './Capabilities'
import { IconSettings } from '@tabler/icons-react'
import { useNavigate } from '@tanstack/react-router'
import { route } from '@/constants/routes'

type DropdownModelProviderProps = {
  threadData?: Thread
}

const DropdownModelProvider = ({ threadData }: DropdownModelProviderProps) => {
  const { providers, selectModelProvider, selectedProvider, selectedModel } =
    useModelProvider()
  const [displayModel, setDisplayModel] = useState<string>('')
  const navigate = useNavigate()

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
      selectModelProvider('llama.cpp', 'llama3.2:3b')
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
            // Only show active providers
            if (!provider.active) return null

            return (
              <div
                className={cn(
                  'bg-main-view-fg/4 first:mt-0 rounded-sm pb-1 my-1.5 first:mb-0 '
                )}
                key={`provider-${index}`}
              >
                <div className="flex items-center justify-between">
                  <DropdownMenuLabel className="flex items-center gap-1.5">
                    <img
                      src={getProviderLogo(provider.provider)}
                      alt={`${provider.provider} - Logo`}
                      className="size-4"
                    />
                    <span className="capitalize">
                      {getProviderTitle(provider.provider)}
                    </span>
                  </DropdownMenuLabel>
                  <div
                    className="size-6 cursor-pointer flex items-center justify-center rounded hover:bg-main-view-fg/10 transition-all duration-200 ease-in-out mr-2"
                    onClick={() =>
                      navigate({
                        to: route.settings.providers,
                        params: { providerName: provider.provider },
                      })
                    }
                  >
                    <IconSettings size={18} className="text-main-view-fg/50" />
                  </div>
                </div>

                {provider.models.map((model, modelIndex) => {
                  const capabilities = model.capabilities || []

                  return (
                    <DropdownMenuItem
                      className="h-8 mx-1"
                      key={`model-${modelIndex}`}
                      onClick={() =>
                        selectModelProvider(provider.provider, model.id)
                      }
                    >
                      <div className="flex items-center gap-1.5 w-full">
                        <span className="text-main-view-fg/70">{model.id}</span>
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
