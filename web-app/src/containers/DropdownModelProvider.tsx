import { useEffect, useState, useRef, useMemo, useCallback } from 'react'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { useModelProvider } from '@/hooks/useModelProvider'
import { cn, getProviderTitle } from '@/lib/utils'
import { highlightFzfMatch } from '@/utils/highlight'
import Capabilities from './Capabilities'
import { IconSettings, IconX } from '@tabler/icons-react'
import { useNavigate } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import { useThreads } from '@/hooks/useThreads'
import { ModelSetting } from '@/containers/ModelSetting'
import ProvidersAvatar from '@/containers/ProvidersAvatar'
import { Fzf } from 'fzf'
import { localStorageKey } from '@/constants/localStorage'

type DropdownModelProviderProps = {
  model?: ThreadModel
  useLastUsedModel?: boolean
}

interface SearchableModel {
  provider: ModelProvider
  model: Model
  searchStr: string
  value: string
  highlightedId?: string
}

// Helper functions for localStorage
const getLastUsedModel = (): { provider: string; model: string } | null => {
  try {
    const stored = localStorage.getItem(localStorageKey.lastUsedModel)
    return stored ? JSON.parse(stored) : null
  } catch (error) {
    console.debug('Failed to get last used model from localStorage:', error)
    return null
  }
}

const setLastUsedModel = (provider: string, model: string) => {
  try {
    localStorage.setItem(
      localStorageKey.lastUsedModel,
      JSON.stringify({ provider, model })
    )
  } catch (error) {
    console.debug('Failed to set last used model in localStorage:', error)
  }
}

const DropdownModelProvider = ({
  model,
  useLastUsedModel = false,
}: DropdownModelProviderProps) => {
  const {
    providers,
    getProviderByName,
    selectModelProvider,
    getModelBy,
    selectedProvider,
    selectedModel,
  } = useModelProvider()
  const [displayModel, setDisplayModel] = useState<string>('')
  const { updateCurrentThreadModel } = useThreads()
  const navigate = useNavigate()

  // Search state
  const [open, setOpen] = useState(false)
  const [searchValue, setSearchValue] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)

  // Initialize model provider only once
  useEffect(() => {
    // Auto select model when existing thread is passed
    if (model) {
      selectModelProvider(model?.provider as string, model?.id as string)
    } else if (useLastUsedModel) {
      // Try to use last used model only when explicitly requested (for new chat)
      const lastUsed = getLastUsedModel()
      if (lastUsed) {
        // Verify the last used model still exists
        const provider = providers.find(
          (p) => p.provider === lastUsed.provider && p.active
        )
        const modelExists = provider?.models.find(
          (m) => m.id === lastUsed.model
        )

        if (provider && modelExists) {
          selectModelProvider(lastUsed.provider, lastUsed.model)
        } else {
          // Fallback to default model if last used model no longer exists
          selectModelProvider('llama.cpp', 'llama3.2:3b')
        }
      } else {
        // default model, we should add from setting
        selectModelProvider('llama.cpp', 'llama3.2:3b')
      }
    } else {
      // default model for non-new-chat contexts
      selectModelProvider('llama.cpp', 'llama3.2:3b')
    }
  }, [
    model,
    selectModelProvider,
    updateCurrentThreadModel,
    providers,
    useLastUsedModel,
  ])

  // Update display model when selection changes
  useEffect(() => {
    if (selectedProvider && selectedModel) {
      setDisplayModel(selectedModel.id)
    } else {
      setDisplayModel('Select a model')
    }
  }, [selectedProvider, selectedModel])

  // Reset search value when dropdown closes
  const onOpenChange = useCallback((open: boolean) => {
    setOpen(open)
    if (!open) {
      requestAnimationFrame(() => setSearchValue(''))
    } else {
      // Focus search input when opening
      setTimeout(() => {
        searchInputRef.current?.focus()
      }, 100)
    }
  }, [])

  // Clear search and focus input
  const onClearSearch = useCallback(() => {
    setSearchValue('')
    searchInputRef.current?.focus()
  }, [])

  // Create searchable items from all models
  const searchableItems = useMemo(() => {
    const items: SearchableModel[] = []

    providers.forEach((provider) => {
      if (!provider.active) return

      provider.models.forEach((modelItem) => {
        // Skip models that require API key but don't have one (except llama.cpp)
        if (provider.provider !== 'llama.cpp' && !provider.api_key?.length) {
          return
        }

        const capabilities = modelItem.capabilities || []
        const capabilitiesString = capabilities.join(' ')
        const providerTitle = getProviderTitle(provider.provider)

        // Create search string with model id, provider, and capabilities
        const searchStr =
          `${modelItem.id} ${providerTitle} ${provider.provider} ${capabilitiesString}`.toLowerCase()

        items.push({
          provider,
          model: modelItem,
          searchStr,
          value: `${provider.provider}:${modelItem.id}`,
        })
      })
    })

    return items
  }, [providers])

  // Create Fzf instance for fuzzy search
  const fzfInstance = useMemo(() => {
    return new Fzf(searchableItems, {
      selector: (item) => item.model.id.toLowerCase(),
    })
  }, [searchableItems])

  // Filter models based on search value
  const filteredItems = useMemo(() => {
    if (!searchValue) return searchableItems

    return fzfInstance.find(searchValue.toLowerCase()).map((result) => {
      const item = result.item
      const positions = Array.from(result.positions) || []
      const highlightedId = highlightFzfMatch(
        item.model.id,
        positions,
        'text-accent'
      )

      return {
        ...item,
        highlightedId,
      }
    })
  }, [searchableItems, searchValue, fzfInstance])

  // Group filtered items by provider
  const groupedItems = useMemo(() => {
    const groups: Record<string, SearchableModel[]> = {}

    if (!searchValue) {
      // When not searching, show all active providers (even without models)
      providers.forEach((provider) => {
        if (provider.active) {
          groups[provider.provider] = []
        }
      })
    }

    // Add the filtered items to their respective groups
    filteredItems.forEach((item) => {
      const providerKey = item.provider.provider
      if (!groups[providerKey]) {
        groups[providerKey] = []
      }
      groups[providerKey].push(item)
    })

    return groups
  }, [filteredItems, providers, searchValue])

  const handleSelect = useCallback(
    (searchableModel: SearchableModel) => {
      selectModelProvider(
        searchableModel.provider.provider,
        searchableModel.model.id
      )
      updateCurrentThreadModel({
        id: searchableModel.model.id,
        provider: searchableModel.provider.provider,
      })
      // Store the selected model as last used
      if (useLastUsedModel) {
        setLastUsedModel(
          searchableModel.provider.provider,
          searchableModel.model.id
        )
      }
      setSearchValue('')
      setOpen(false)
    },
    [selectModelProvider, updateCurrentThreadModel, useLastUsedModel]
  )

  const currentModel = selectedModel?.id
    ? getModelBy(selectedModel?.id)
    : undefined

  if (!providers.length) return null

  const provider = getProviderByName(selectedProvider)

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <div className="bg-main-view-fg/5 hover:bg-main-view-fg/8 px-2 py-1 flex items-center gap-1.5 rounded-sm max-h-[32px] ">
        <PopoverTrigger asChild>
          <button
            title={displayModel}
            className="font-medium cursor-pointer flex items-center gap-1.5 relative z-20 max-w-38"
          >
            {provider && (
              <div className="shrink-0">
                <ProvidersAvatar provider={provider} />
              </div>
            )}
            <span
              className={cn(
                'text-main-view-fg/80 truncate leading-normal',
                !selectedModel?.id && 'text-main-view-fg/50'
              )}
            >
              {displayModel}
            </span>
          </button>
        </PopoverTrigger>
        {currentModel?.settings && provider && (
          <ModelSetting
            model={currentModel as Model}
            provider={provider}
            smallIcon
          />
        )}
      </div>

      <PopoverContent
        className={cn(
          'w-60 p-0 backdrop-blur-2xl',
          searchValue.length === 0 && 'h-[320px]'
        )}
        align="start"
        sideOffset={10}
        alignOffset={-8}
        side={searchValue.length === 0 ? undefined : 'top'}
        avoidCollisions={searchValue.length === 0 ? true : false}
      >
        <div className="flex flex-col w-full h-full">
          {/* Search input */}
          <div className="relative px-2 py-1.5 border-b border-main-view-fg/10 backdrop-blur-4xl">
            <input
              ref={searchInputRef}
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              placeholder="Search models..."
              className="text-sm font-normal outline-0"
            />
            {searchValue.length > 0 && (
              <div className="absolute right-2 top-0 bottom-0 flex items-center justify-center">
                <IconX
                  size={16}
                  className="text-main-view-fg/50 hover:text-main-view-fg cursor-pointer"
                  onClick={onClearSearch}
                />
              </div>
            )}
          </div>

          {/* Model list */}
          <div className="max-h-[320px] overflow-y-auto">
            {Object.keys(groupedItems).length === 0 && searchValue ? (
              <div className="py-3 px-4 text-sm text-main-view-fg/60">
                No models found for "{searchValue}"
              </div>
            ) : (
              <div className="py-1">
                {Object.entries(groupedItems).map(([providerKey, models]) => {
                  const providerInfo = providers.find(
                    (p) => p.provider === providerKey
                  )

                  if (!providerInfo) return null

                  return (
                    <div
                      key={providerKey}
                      className="bg-main-view-fg/4 backdrop-blur-2xl first:mt-0 rounded-sm my-1.5 mx-1.5 first:mb-0"
                    >
                      {/* Provider header */}
                      <div className="flex items-center justify-between px-2 py-1">
                        <div className="flex items-center gap-1.5">
                          <ProvidersAvatar provider={providerInfo} />
                          <span className="capitalize truncate text-sm font-medium text-main-view-fg/80">
                            {getProviderTitle(providerInfo.provider)}
                          </span>
                        </div>
                        <div
                          className="size-6 cursor-pointer flex items-center justify-center rounded-sm hover:bg-main-view-fg/10 transition-all duration-200 ease-in-out"
                          onClick={(e) => {
                            e.stopPropagation()
                            navigate({
                              to: route.settings.providers,
                              params: { providerName: providerInfo.provider },
                            })
                            setOpen(false)
                          }}
                        >
                          <IconSettings
                            size={16}
                            className="text-main-view-fg/50"
                          />
                        </div>
                      </div>

                      {/* Models for this provider */}
                      {models.length === 0 ? (
                        // Show message when provider has no available models
                        <></>
                      ) : (
                        models.map((searchableModel) => {
                          const isSelected =
                            selectedModel?.id === searchableModel.model.id &&
                            selectedProvider ===
                              searchableModel.provider.provider
                          const capabilities =
                            searchableModel.model.capabilities || []

                          return (
                            <div
                              key={searchableModel.value}
                              onClick={() => handleSelect(searchableModel)}
                              className={cn(
                                'mx-1 mb-1 px-2 py-1.5 rounded-sm cursor-pointer flex items-center gap-2 transition-all duration-200',
                                'hover:bg-main-view-fg/10',
                                isSelected && 'bg-main-view-fg/15'
                              )}
                            >
                              <div className="flex items-center gap-2 flex-1 min-w-0">
                                <span
                                  className="truncate text-main-view-fg/80 text-sm"
                                  dangerouslySetInnerHTML={{
                                    __html:
                                      searchableModel.highlightedId ||
                                      searchableModel.model.id,
                                  }}
                                />

                                <div className="flex-1"></div>
                                {capabilities.length > 0 && (
                                  <div className="flex-shrink-0 -mr-1.5">
                                    <Capabilities capabilities={capabilities} />
                                  </div>
                                )}
                              </div>
                            </div>
                          )
                        })
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

export default DropdownModelProvider
